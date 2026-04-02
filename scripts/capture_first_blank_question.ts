import { loadConfig } from "../src/config";
import { BrowserEngine } from "../src/browser";
import {
  applySuggestedAnswers,
  deriveChoiceSuggestions,
  navigateToDailyQuiz,
  openHintAndExtract,
  readQuizQuestionSnapshot,
  submitCurrentAnswer,
} from "../src/tasks/quiz_helpers";
import { delay } from "../src/tasks/timing";
import * as fs from "fs";
import * as path from "path";

const BLANK_LIKE_PATTERN = /（\s*）|__+|﹍+|＿+|\[\s*\]/;

async function waitForEnter(message: string): Promise<void> {
  process.stdout.write(`${message}\n`);
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });
}

async function captureCurrentBlank(page: import("puppeteer-core").Page) {
  const result = await page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const withRect = (node: Element) => {
      const rect = (node as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(node as HTMLElement);
      return {
        tag: node.tagName,
        className: (node as HTMLElement).className || "",
        text: normalize(node.textContent).slice(0, 300),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        style: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          color: style.color,
          fontWeight: style.fontWeight,
        },
      };
    };

    const blankLike = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true'], span, div"))
      .filter((node) => {
        const el = node as HTMLElement;
        const text = normalize(el.textContent);
        const cls = el.className || "";
        return (
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement ||
          el.getAttribute("contenteditable") === "true" ||
          cls.includes("blank") ||
          cls.includes("input") ||
          cls.includes("answer") ||
          text === "" ||
          /^_{2,}$/.test(text)
        );
      })
      .map(withRect)
      .slice(0, 200);

    const popoverLike = Array.from(document.querySelectorAll(".ant-popover, .ant-popover-inner, .ant-popover-inner-content, [class*='popover'], [class*='tip']"))
      .map(withRect)
      .filter((node) => node.text.length > 0)
      .slice(0, 100);

    const questionLike = Array.from(document.querySelectorAll(".question, .q-body, .q-answers, .q-answer, .q-footer, .detail-body"))
      .map(withRect);

    return {
      url: window.location.href,
      title: document.title,
      bodyText: normalize(document.body?.innerText).slice(0, 2500),
      blankLike,
      popoverLike,
      questionLike,
    };
  });

  const screenshotPath = path.join(process.cwd(), "tmp", "captured-first-blank-question.png");
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ ...result, screenshotPath }, null, 2));
}

async function main() {
  const config = loadConfig();
  const engine = new BrowserEngine();

  try {
    await engine.init(config);
    const page = engine.page!;
    await navigateToDailyQuiz(page, delay);

    for (let step = 0; step < 5; step++) {
      const snapshot = await readQuizQuestionSnapshot(page);
      if (!snapshot.stem) {
        throw new Error("未能读取当前题目");
      }

      console.log(`[诊断] 当前题型：${snapshot.questionType}，题干：${snapshot.stem}`);
      const hintText = await openHintAndExtract(page, delay);

      const blankLikeWithoutChoices = BLANK_LIKE_PATTERN.test(snapshot.stem) && snapshot.options.length === 0;
      if (snapshot.questionType === "blank" || blankLikeWithoutChoices) {
        console.log(`[诊断] 已到达填空题，提示摘录：${hintText.slice(0, 160)}`);
        await captureCurrentBlank(page);
        return;
      }

      const suggestions = deriveChoiceSuggestions(snapshot.options, hintText);
      if (snapshot.questionType === "single" && suggestions.length !== 1) {
        console.log(`[诊断] 当前单选题建议数=${suggestions.length}，暂停等待人工作答。`);
        await waitForEnter("【请在浏览器中手动完成当前题，然后在这里按 Enter 继续推进到下一题】");
        continue;
      }

      if (snapshot.questionType === "multiple" && suggestions.length === 0) {
        console.log("[诊断] 当前多选题没有可靠建议，暂停等待人工作答。");
        await waitForEnter("【请在浏览器中手动完成当前题，然后在这里按 Enter 继续推进到下一题】");
        continue;
      }

      const applied = await applySuggestedAnswers(page, snapshot, suggestions, delay);
      console.log(`[诊断] 自动勾选：${applied.join(" | ") || "(无)"}`);
      const submitResult = await submitCurrentAnswer(page, snapshot, delay);
      if (!submitResult.submitted) {
        throw new Error("诊断流程提交失败");
      }
      if (submitResult.finished) {
        throw new Error("在遇到填空题前答题流程已结束");
      }
      if (!submitResult.advanced) {
        throw new Error("提交后未能进入下一题");
      }
    }

    throw new Error("在前 5 题中未遇到填空题");
  } finally {
    await engine.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
