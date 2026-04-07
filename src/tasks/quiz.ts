import type { Page } from "puppeteer-core";
import type { IQuizConfig } from "../config";
import { isLlmConfigured, solveQuizWithLlm } from "../llm";
import {
  applyBlankAnswers,
  applySuggestedAnswers,
  deriveBlankSuggestion,
  deriveChoiceSuggestions,
  deriveOrderedBlankSuggestions,
  extractHintHighlights,
  hasAdvancedToDifferentQuestion,
  isBlankQuestionType,
  pickSingleBlankFromHighlights,
  navigateToDailyQuiz,
  openHintAndExtract,
  previewQuestionVideo,
  readQuizQuestionSnapshot,
  submitCurrentAnswer,
} from "./quiz_helpers";
import { delay } from "./timing";

function waitForTerminalContinue(): { promise: Promise<"terminal">; cancel: () => void } {
  let settled = false;
  const stdin = process.stdin;

  const cleanup = () => {
    stdin.off("data", onData);
    if (stdin.isTTY) {
      stdin.pause();
    }
  };

  const onData = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolvePromise("terminal");
  };

  let resolvePromise!: (value: "terminal") => void;
  const promise = new Promise<"terminal">((resolve) => {
    resolvePromise = resolve;
  });

  stdin.resume();
  stdin.once("data", onData);

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}

async function injectContinueOverlay(page: Page, token: string, message: string): Promise<void> {
  await page.evaluate(({ currentToken, currentMessage }) => {
    const existing = document.getElementById("aixuexi-continue-overlay");
    existing?.remove();

    const overlay = document.createElement("div");
    overlay.id = "aixuexi-continue-overlay";
    overlay.style.position = "fixed";
    overlay.style.right = "24px";
    overlay.style.bottom = "24px";
    overlay.style.zIndex = "2147483647";
    overlay.style.width = "320px";
    overlay.style.background = "rgba(20,20,20,0.92)";
    overlay.style.color = "#fff";
    overlay.style.padding = "14px";
    overlay.style.borderRadius = "12px";
    overlay.style.boxShadow = "0 16px 40px rgba(0,0,0,0.35)";
    overlay.style.fontSize = "14px";
    overlay.style.lineHeight = "1.5";

    const text = document.createElement("div");
    text.textContent = currentMessage;
    text.style.marginBottom = "10px";

    const button = document.createElement("button");
    button.textContent = "继续";
    button.style.width = "100%";
    button.style.border = "0";
    button.style.borderRadius = "8px";
    button.style.padding = "10px 12px";
    button.style.background = "#00c482";
    button.style.color = "#fff";
    button.style.fontWeight = "700";
    button.style.cursor = "pointer";
    button.onclick = () => {
      (window as typeof window & { __aixuexiContinueToken?: string }).__aixuexiContinueToken = currentToken;
      overlay.remove();
    };

    overlay.appendChild(text);
    overlay.appendChild(button);
    document.body.appendChild(overlay);
  }, { currentToken: token, currentMessage: message });
}

async function removeContinueOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("aixuexi-continue-overlay")?.remove();
  }).catch(() => null);
}

async function waitForUserContinue(page: Page, message: string): Promise<void> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(message);
  const terminalWaiter = waitForTerminalContinue();

  const pageWaiter = (async (): Promise<"page"> => {
    while (true) {
      await injectContinueOverlay(page, token, message).catch(() => null);

      const clicked = await page.evaluate((expectedToken) => {
        return (window as typeof window & { __aixuexiContinueToken?: string }).__aixuexiContinueToken === expectedToken;
      }, token).catch(() => false);

      if (clicked) {
        return "page";
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 350));
    }
  })();

  const continueFrom = await Promise.race([pageWaiter, terminalWaiter.promise]).finally(() => {
    terminalWaiter.cancel();
  });

  await removeContinueOverlay(page);
  if (continueFrom === "terminal") {
    console.log("已收到终端回车，继续执行。");
  }
}

async function handleLegacyManualQuiz(page: Page, score: number, max: number): Promise<void> {
  if (score >= max) {
    console.log(`每日答题已满分 (${score}/${max})，自动跳过。`);
    return;
  }

  console.log(`\x07\n====== 智能提示 ======`);
  console.log(`目前每日答题得分为 ${score}/${max}。`);
  console.log("请点击进入浏览器页面，手动完成【每日答题】后再告知程序继续。");
  await waitForUserContinue(page, "答题完成后，请点击浏览器右下角“继续”按钮，或在终端按 Enter。");
  console.log("收到继续信号，恢复执行自动化任务...");
}

function printSuggestions(questionType: string, suggestions: string[], hintText: string) {
  console.log(`[测验任务] 建议题型：${questionType}`);
  if (suggestions.length > 0) {
    console.log(`[测验任务] 建议答案：${suggestions.join(" | ")}`);
  } else {
    console.log("[测验任务] 暂未从提示中提取到明确答案，请人工确认。");
  }
  if (hintText) {
    console.log(`[测验任务] 提示摘录：${hintText.slice(0, 120)}`);
  } else {
    console.log("[测验任务] 未检测到提示文本。");
  }
}

function resolveActionableSuggestions(questionType: string, suggestions: string[]): string[] {
  if (questionType === "single") {
    return suggestions.length === 1 ? suggestions : [];
  }
  return suggestions;
}

function blankSuggestionsLookUsable(suggestions: string[], blankCount: number): boolean {
  if (suggestions.length === 0) return false;
  if (suggestions.length === blankCount) return true;
  if (suggestions.length === 1) {
    const compact = suggestions[0]?.replace(/\s+/g, "") || "";
    return compact.length > 0 && compact.length <= Math.max(16, blankCount * 4);
  }
  return false;
}

function isTrueFalseQuestion(options: string[]): boolean {
  const normalized = options.map((item) => item.replace(/^[A-D][.．、]?\s*/, "").trim());
  return normalized.length === 2 && (
    (normalized.includes("正确") && normalized.includes("错误")) ||
    (normalized.includes("对") && normalized.includes("错"))
  );
}

async function runSemiAutoQuiz(page: Page, score: number, max: number, quizConfig?: IQuizConfig): Promise<void> {
  const forceRunWhenFull = quizConfig?.forceRunWhenFull ?? false;
  if (score >= max && !forceRunWhenFull) {
    console.log(`每日答题已满分 (${score}/${max})，自动跳过。`);
    return;
  }

  console.log(`\x07\n====== 半自动答题 ======`);
  console.log(`目前每日答题得分为 ${score}/${max}。`);
  if (score >= max && forceRunWhenFull) {
    console.log("已启用强制调试模式：即使满分也继续进入每日答题进行流程验证。");
  }
  console.log("程序将进入每日答题页，分析题目并给出建议答案。");
  if (quizConfig?.stopAtFirstBlankForDebug) {
    console.log("[测验任务] 调试开关已开启：命中首个填空题后将暂停并结束本轮。");
  }

  try {
    await navigateToDailyQuiz(page, delay);
  } catch {
    console.log("[测验任务] 从积分页进入失败，回退直达每日答题页面。");
    await page.goto("https://pc.xuexi.cn/points/exam-practice.html", { waitUntil: "networkidle2" });
    await delay(1200, 2000);
  }

  const maxRounds = forceRunWhenFull
    ? Math.max(1, quizConfig?.testRounds ?? 3)
    : Math.max(1, max - score);
  let completedRounds = 0;
  let stagnantRounds = 0;

  while (completedRounds < maxRounds) {
    const snapshot = await readQuizQuestionSnapshot(page);
    if (!snapshot.stem) {
      console.log("[测验任务] 未能识别当前题目，停止自动循环。");
      break;
    }

    const prefix =
      snapshot.currentIndex > 0 && snapshot.totalQuestions > 0
        ? `[测验任务][${snapshot.currentIndex}/${snapshot.totalQuestions}]`
        : `[测验任务][${completedRounds + 1}]`;

    console.log(`${prefix} 题干：${snapshot.stem}`);
    if (snapshot.options.length > 0) {
      console.log(`${prefix} 选项：${snapshot.options.join(" | ")}`);
    }

    const hintText = await openHintAndExtract(page, delay);
    let suggestions: string[] = [];
    if (isBlankQuestionType(snapshot.questionType)) {
      const blankCount = Math.max(1, snapshot.blankCount || 1);
      const highlighted = await extractHintHighlights(page);
      if (snapshot.questionType === "single_blank" && highlighted.length > 0) {
        const picked = pickSingleBlankFromHighlights(snapshot.stem, hintText, highlighted);
        if (picked) {
          suggestions = [picked];
        } else {
          suggestions = deriveOrderedBlankSuggestions(snapshot.stem, hintText, blankCount);
        }
      } else if (highlighted.length > 0 && highlighted.length === blankCount) {
        suggestions = highlighted.slice(0, blankCount);
      } else {
        suggestions = deriveOrderedBlankSuggestions(snapshot.stem, hintText, blankCount);
      }
    } else {
      suggestions = deriveChoiceSuggestions(snapshot.options, hintText);
    }

    const shouldUseLlm =
      (quizConfig?.llmEnabled ?? true) &&
      isLlmConfigured() &&
      (
        (snapshot.questionType === "single" && (suggestions.length !== 1 || isTrueFalseQuestion(snapshot.options))) ||
        (snapshot.questionType === "multiple" && suggestions.length === 0) ||
        (isBlankQuestionType(snapshot.questionType) && !blankSuggestionsLookUsable(suggestions, Math.max(1, snapshot.blankCount || 1)))
      );

    if (shouldUseLlm) {
      try {
        const llmResult = await solveQuizWithLlm({
          stem: snapshot.stem,
          options: snapshot.options,
          hintText,
          questionType: snapshot.questionType,
          blankCount: snapshot.blankCount,
        });

        if (llmResult?.answers?.length) {
          suggestions = llmResult.answers;
          console.log(`${prefix} 已调用 LLM 判题${llmResult.reason ? `：${llmResult.reason}` : ""}`);
        } else {
          console.log(`${prefix} LLM 未返回可用答案，保留规则结果。`);
        }
      } catch (error) {
        console.warn(`${prefix} LLM 判题失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    printSuggestions(snapshot.questionType, suggestions, hintText);

    const actionableSuggestions = resolveActionableSuggestions(snapshot.questionType, suggestions);
    if (snapshot.questionType === "single" && suggestions.length > 1) {
      console.log(`${prefix} 提示同时命中多个单选项，已停止自动勾选，请人工判断。`);
    }

    const appliedSuggestions = await applySuggestedAnswers(page, snapshot, actionableSuggestions, delay);
    const appliedBlankAnswers =
      isBlankQuestionType(snapshot.questionType) ? await applyBlankAnswers(page, actionableSuggestions, delay) : [];

    if (appliedSuggestions.length > 0) {
      console.log(`${prefix} 已自动勾选：${appliedSuggestions.join(" | ")}`);
    } else if (appliedBlankAnswers.length > 0) {
      console.log(`${prefix} 已自动填空：${appliedBlankAnswers.join(" | ")}`);
    } else if (!isBlankQuestionType(snapshot.questionType) && actionableSuggestions.length > 0) {
      console.log(`${prefix} 找到了建议答案，但未能自动勾选，请人工核对。`);
    } else if (isBlankQuestionType(snapshot.questionType) && actionableSuggestions.length > 0) {
      console.log(`${prefix} 已提取填空候选，但未能自动写入，请人工核对。`);
    }

    if (quizConfig?.stopAtFirstBlankForDebug && isBlankQuestionType(snapshot.questionType)) {
      console.log(`${prefix} 已命中填空题，已执行自动填入步骤；按 stopAtFirstBlankForDebug 暂停等待你验收。`);
      await waitForUserContinue(page, "填空题自动填入已执行。请检查页面是否真的写入，再点击右下角“继续”结束本轮调试。");
      break;
    }

    if (snapshot.hasVideo) {
      console.log(`${prefix} 检测到题干内含视频，先自动播放一小段，请随后人工接管。`);
      await previewQuestionVideo(page, delay, quizConfig?.videoPreviewSeconds ?? 20);
      await waitForUserContinue(page, "请在浏览器中观看视频并确认答案，准备提交后点击右下角“继续”，或在终端按 Enter。");
    } else {
      await waitForUserContinue(page, "请在浏览器中核对建议答案，准备提交后点击右下角“继续”，或在终端按 Enter。");
    }

    const submitResult = await submitCurrentAnswer(page, snapshot, delay);
    if (!submitResult.submitted) {
      console.log(`${prefix} 未找到提交按钮，请人工提交当前题目。`);
      await waitForUserContinue(page, "人工提交完成后，请点击浏览器右下角“继续”，或在终端按 Enter。");
      break;
    }

    console.log(`${prefix} 已尝试提交当前题目。`);
    if (submitResult.finished) {
      completedRounds++;
      console.log("[测验任务] 检测到本轮答题已结束。");
      break;
    }

    if (submitResult.advanced) {
      completedRounds++;
      stagnantRounds = 0;
      continue;
    }

    console.log("[测验任务] 提交后暂未识别到下一题，等待页面稳定后继续观察。");
    await delay(isBlankQuestionType(snapshot.questionType) ? 3200 : 1400, isBlankQuestionType(snapshot.questionType) ? 4800 : 2200);
    const retrySnapshot = await readQuizQuestionSnapshot(page);
    const advancedAfterWait = hasAdvancedToDifferentQuestion(snapshot, retrySnapshot);
    if (advancedAfterWait) {
      completedRounds++;
      stagnantRounds = 0;
      console.log("[测验任务] 追加等待后已进入下一题，继续执行。");
      continue;
    }
    stagnantRounds++;
    if (stagnantRounds >= 2) {
      console.log("[测验任务] 连续两次未能识别到下一题，本轮暂停。");
      break;
    }
    console.log("[测验任务] 追加等待后仍未识别到下一题，将重读当前页面后继续尝试。");
  }

  console.log("半自动答题本轮执行完毕。");
  await waitForUserContinue(page, "如果你已完成本轮答题，请点击浏览器右下角“继续”，或在终端按 Enter 返回主流程。");
}

export async function handleManualQuiz(page: Page, score: number, max: number, quizConfig?: IQuizConfig): Promise<void> {
  if ((quizConfig?.mode ?? "manual") === "semi-auto") {
    await runSemiAutoQuiz(page, score, max, quizConfig);
    return;
  }

  await handleLegacyManualQuiz(page, score, max);
}
