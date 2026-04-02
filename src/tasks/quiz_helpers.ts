import type { Page } from "puppeteer-core";

export type QuizQuestionType = "single" | "multiple" | "blank" | "unknown";

export interface QuizQuestionSnapshot {
  stem: string;
  options: string[];
  questionType: QuizQuestionType;
  blankCount: number;
  hasVideo: boolean;
  currentIndex: number;
  totalQuestions: number;
}

interface ParsedQuestionText {
  stem: string;
  options: string[];
  questionType: QuizQuestionType;
}

export function normalizeQuizText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function deriveChoiceSuggestions(options: string[], hintText: string): string[] {
  const compactHint = normalizeQuizText(hintText).replace(/\s+/g, "");
  return options.filter((option) => {
    const compactOption = normalizeQuizText(option).replace(/^[A-D][.．、]?\s*/, "").replace(/\s+/g, "");
    if (!compactOption) return false;
    if (compactOption.length === 1) {
      return /[\u4e00-\u9fff]/.test(compactOption) && compactHint.includes(compactOption);
    }
    return compactHint.includes(compactOption);
  });
}

export function deriveBlankSuggestion(hintText: string): string[] {
  const normalized = normalizeQuizText(hintText);
  if (!normalized) return [];

  const quoted = normalized.match(/[“"《](.{2,40})[”"》]/g) || [];
  if (quoted.length > 0) {
    return quoted.map((item) => item.replace(/[“"《》”]/g, ""));
  }

  return [normalized.slice(0, 80)];
}

const BLANK_PATTERN = /（\s*）|__+|﹍+|＿+|\[\s*\]/g;

function trimAnswerFragment(text: string): string {
  return normalizeQuizText(text).replace(/^[，。；：、“”‘’\s]+|[，。；：、“”‘’\s]+$/g, "");
}

function normalizeBlankContext(text: string): string {
  return normalizeQuizText(text).replace(/[，。；：、“”‘’\s]+$/g, "");
}

function inferSingleBlankByDiff(stem: string, hint: string): string {
  const a = normalizeQuizText(stem);
  const b = normalizeQuizText(hint);
  if (!a || !b || a === b) return "";

  let left = 0;
  while (left < a.length && left < b.length && a[left] === b[left]) {
    left++;
  }

  let right = 0;
  while (
    right < a.length - left &&
    right < b.length - left &&
    a[a.length - 1 - right] === b[b.length - 1 - right]
  ) {
    right++;
  }

  const inserted = trimAnswerFragment(b.slice(left, b.length - right));
  if (!inserted) return "";
  if (inserted.length > 24) return "";
  return inserted;
}

export function tokenizeBlankAnswerByCandidates(answer: string, candidates: string[]): string[] {
  const target = normalizeQuizText(answer).replace(/\s+/g, "");
  const parts = candidates
    .map((item) => normalizeQuizText(item).replace(/\s+/g, ""))
    .filter(Boolean);
  if (!target || parts.length === 0) return [];

  const sorted = Array.from(new Set(parts)).sort((a, b) => b.length - a.length);
  let remain = target;
  const out: string[] = [];

  while (remain.length > 0) {
    const picked = sorted.find((item) => remain.startsWith(item));
    if (!picked) {
      return [];
    }
    out.push(picked);
    remain = remain.slice(picked.length);
  }

  return out;
}

export function deriveOrderedBlankSuggestions(stem: string, hintText: string, blankCount: number): string[] {
  const normalizedStem = normalizeQuizText(stem);
  const normalizedHint = normalizeQuizText(hintText);
  if (!normalizedStem || !normalizedHint || blankCount <= 0) {
    return [];
  }

  const parts = normalizedStem.split(BLANK_PATTERN).map((part) => normalizeQuizText(part));
  if (blankCount === 1 && parts.length < 2) {
    const diffAnswer = inferSingleBlankByDiff(normalizedStem, normalizedHint);
    if (diffAnswer) {
      return [diffAnswer];
    }
  }

  if (parts.length >= blankCount + 1) {
    const answers: string[] = [];
    let cursor = 0;

    for (let index = 0; index < blankCount; index++) {
      const left = normalizeBlankContext(parts[index] || "");
      const right = normalizeBlankContext(parts[index + 1] || "");

      if (left) {
        const leftIndex = normalizedHint.indexOf(left, cursor);
        if (leftIndex !== -1) {
          cursor = leftIndex + left.length;
        }
      }

      let end = normalizedHint.length;
      if (right) {
        const rightIndex = normalizedHint.indexOf(right, cursor);
        if (rightIndex !== -1) {
          end = rightIndex;
        }
      }

      const fragment = trimAnswerFragment(normalizedHint.slice(cursor, end));
      if (fragment) {
        answers.push(fragment);
      }

      if (right) {
        const rightIndex = normalizedHint.indexOf(right, cursor);
        if (rightIndex !== -1) {
          cursor = rightIndex;
        }
      }
    }

    if (answers.length === blankCount && answers.every(Boolean)) {
      return answers;
    }
  }

  const quoted = normalizedHint.match(/[“"《](.{1,80})[”"》]/g) || [];
  const quotedAnswers = quoted.map((item) => item.replace(/[“"《》”]/g, "").trim()).filter(Boolean);
  if (quotedAnswers.length >= blankCount) {
    return quotedAnswers.slice(0, blankCount);
  }

  const fallback = deriveBlankSuggestion(normalizedHint);
  return fallback.slice(0, blankCount);
}

export function parseQuestionFromRawText(rawText: string): ParsedQuestionText {
  const normalized = normalizeQuizText(rawText);
  const lines = rawText
    .split("\n")
    .map((line) => normalizeQuizText(line))
    .filter(Boolean);

  let questionType: QuizQuestionType = "unknown";
  if (normalized.includes("多选题")) questionType = "multiple";
  else if (normalized.includes("单选题")) questionType = "single";
  else if (normalized.includes("填空题")) questionType = "blank";

  const lineOptions = lines.filter((line) => /^[A-D][.．、]\s*/.test(line));
  const regexOptions = Array.from(normalized.matchAll(/([A-D])[.．、]\s*([\s\S]*?)(?=[A-D][.．、]\s*|出题：|来源：|查看提示|确\s*定|$)/g))
    .map((match) => `${match[1]}. ${normalizeQuizText(match[2] || "")}`);
  const options = Array.from(new Set((lineOptions.length > 0 ? lineOptions : regexOptions).map((item) => item.trim()))).slice(0, 8);

  const typeLineIndex = lines.findIndex((line) => /(单选题|多选题|填空题)/.test(line));
  const trailingStemLines =
    typeLineIndex >= 0
      ? lines.slice(typeLineIndex + 1).filter((line) => {
          return !/^(来源：|查看提示|出题：|确\s*定$|[A-D][.．、])/.test(line);
        })
      : [];

  const inlineStemLine = lines.find((line) => /(单选题|多选题|填空题)/.test(line) && line.length > 6);
  const stemSource = trailingStemLines[0] || inlineStemLine || normalized;
  const stem = normalizeQuizText(
    stemSource
      .replace(/^.*?(单选题|多选题|填空题)/, "")
      .replace(/来源：.*$/, "")
      .replace(/查看提示.*$/, "")
      .replace(/[A-D][.．、]\s*.*$/, "")
  );

  return { stem, options, questionType };
}

function cleanOptionText(option: string): string {
  return normalizeQuizText(option);
}

function isSingleChoiceOption(text: string): boolean {
  if (!/^[A-D][.．、]\s*\S+/.test(text)) return false;
  const labels = text.match(/[A-D][.．、]/g) || [];
  return labels.length === 1;
}

function stripOptionPrefix(text: string): string {
  return normalizeQuizText(text).replace(/^[A-D][.．、]?\s*/, "");
}

function extractOptionLabel(text: string): string {
  const match = normalizeQuizText(text).match(/^([A-D])[.．、]?$/i) || normalizeQuizText(text).match(/^([A-D])[.．、]\s*/i);
  return (match?.[1] || "").toUpperCase();
}

export function matchSuggestedOptions(optionTexts: string[], suggestions: string[]): string[] {
  const normalizedSuggestions = suggestions.map((item) => normalizeQuizText(item));
  const strippedSuggestions = normalizedSuggestions.map((item) => stripOptionPrefix(item));
  const labeledSuggestions = normalizedSuggestions.map((item) => extractOptionLabel(item)).filter(Boolean);

  return optionTexts.filter((option) => {
    const normalizedOption = normalizeQuizText(option);
    const strippedOption = stripOptionPrefix(option);
    const labelOption = extractOptionLabel(option);
    return (
      normalizedSuggestions.includes(normalizedOption) ||
      strippedSuggestions.includes(strippedOption) ||
      (labelOption !== "" && labeledSuggestions.includes(labelOption))
    );
  });
}

export async function navigateToDailyQuiz(page: Page, delay: (min: number, max: number) => Promise<void>): Promise<void> {
  await page.goto("https://pc.xuexi.cn/points/my-points.html", { waitUntil: "networkidle2" });
  await delay(2500, 3500);

  const currentUrl = page.url();
  const cards = await page.$$(".my-points-card");
  for (const card of cards) {
    const text = await page.evaluate((node) => (node.textContent || "").replace(/\s+/g, " ").trim(), card);
    if (!text.includes("每日答题") || !text.includes("去答题")) {
      continue;
    }

    const action = await card.$(".buttonbox, .big");
    const target = action || card;
    await page.evaluate((node) => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }, target);
    await delay(800, 1200);
    await target.click();

    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => null),
      page.waitForFunction(
        (previousUrl) => window.location.href !== previousUrl,
        { timeout: 15000 },
        currentUrl
      ).catch(() => null),
    ]);

    await delay(2000, 3000);
    if (page.url() !== currentUrl) {
      return;
    }
  }

  const entry = await page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const toAbsoluteUrl = (value: string | null | undefined) => {
      if (!value) return "";
      try {
        return new URL(value, window.location.href).toString();
      } catch {
        return "";
      }
    };
    const blocks = Array.from(document.querySelectorAll<HTMLElement>("div, section, li, article"));

    const quizBlock = blocks.find((node) => {
      const text = normalize(node.textContent);
      return text.includes("每日答题") && text.includes("去答题");
    });

    if (quizBlock) {
      const action = Array.from(quizBlock.querySelectorAll<HTMLElement>("a, button, div, span"))
        .find((node) => {
          const text = normalize(node.textContent);
          return text.includes("去答题") || text.includes("答题");
        });

      const actionHref =
        (action instanceof HTMLAnchorElement && toAbsoluteUrl(action.getAttribute("href"))) ||
        toAbsoluteUrl(action?.getAttribute("data-href")) ||
        toAbsoluteUrl(action?.getAttribute("href")) ||
        "";

      if (actionHref) {
        return { href: actionHref, clicked: false };
      }

      const blockHref =
        toAbsoluteUrl(quizBlock.getAttribute("data-href")) ||
        toAbsoluteUrl(quizBlock.getAttribute("href")) ||
        toAbsoluteUrl((quizBlock.querySelector("a[href]") as HTMLAnchorElement | null)?.getAttribute("href")) ||
        "";

      if (blockHref) {
        return { href: blockHref, clicked: false };
      }

      const target = action || quizBlock;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.click();
      return { href: "", clicked: true };
    }

    const directLink = Array.from(document.querySelectorAll<HTMLElement>("a, button, div, span"))
      .find((node) => {
        const text = normalize(node.textContent);
        return text === "去答题" || text === "每日答题";
      });

    if (!directLink) return { href: "", clicked: false };

    const directHref =
      (directLink instanceof HTMLAnchorElement && toAbsoluteUrl(directLink.getAttribute("href"))) ||
      toAbsoluteUrl(directLink.getAttribute("data-href")) ||
      "";

    if (directHref) {
      return { href: directHref, clicked: false };
    }

    directLink.scrollIntoView({ behavior: "smooth", block: "center" });
    directLink.click();
    return { href: "", clicked: true };
  });

  if (!entry.clicked && !entry.href) {
    throw new Error("未能从积分页找到【每日答题】入口");
  }

  if (entry.href) {
    await page.goto(entry.href, { waitUntil: "networkidle2" });
    await delay(2000, 3000);
    return;
  }

  await Promise.race([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => null),
    page.waitForFunction(
      (previousUrl) => window.location.href !== previousUrl,
      { timeout: 15000 },
      currentUrl
    ).catch(() => null),
  ]);

  await delay(2000, 3000);

  const navigated = page.url() !== currentUrl;
  if (!navigated) {
    throw new Error("已点击【每日答题】入口，但页面没有发生跳转");
  }
}

export async function readQuizQuestionSnapshot(page: Page): Promise<QuizQuestionSnapshot> {
  const snapshot = await page.evaluate(() => {
    const rawText = (document.body?.innerText || "").trim();
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const selectorOptions = Array.from(
      document.querySelectorAll<HTMLElement>(".q-answer, .q-answer-text-box, .q-answers .choosable, [class*='q-answer']")
    )
      .map((node) => normalize(node.textContent))
      .filter((text, index, self) => text.length >= 2 && self.indexOf(text) === index);
    const selectorStem =
      normalize(document.querySelector<HTMLElement>(".q-body")?.textContent) ||
      normalize(document.querySelector<HTMLElement>(".question .q-body")?.textContent) ||
      "";
    const progressText =
      normalize(document.querySelector<HTMLElement>(".pager, .q-header, [class*='pager'], [class*='header']")?.textContent) ||
      normalize(document.body?.innerText);
    const progressMatch = progressText.match(/(\d+)\s*\/\s*(\d+)/);
    const blankCount = document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']").length;
    const hasVideo = !!document.querySelector("video, .prism-player, .video-js, [class*='video']");
    return {
      rawText,
      blankCount,
      hasVideo,
      selectorOptions,
      selectorStem,
      currentIndex: progressMatch ? Number(progressMatch[1]) : 0,
      totalQuestions: progressMatch ? Number(progressMatch[2]) : 0,
    };
  });

  const parsed = parseQuestionFromRawText(snapshot.rawText);
  const questionType = snapshot.blankCount > 0 ? "blank" : parsed.questionType;
  const selectorOptions = snapshot.selectorOptions
    .map(cleanOptionText)
    .filter((text) => text.length > 2 && isSingleChoiceOption(text));
  return {
    stem: snapshot.selectorStem || parsed.stem,
    options: selectorOptions.length > 0 ? selectorOptions : parsed.options,
    questionType,
    blankCount: snapshot.blankCount,
    hasVideo: snapshot.hasVideo,
    currentIndex: snapshot.currentIndex,
    totalQuestions: snapshot.totalQuestions,
  };
}

export async function openHintAndExtract(page: Page, delay: (min: number, max: number) => Promise<void>): Promise<string> {
  const beforeText = await page.evaluate(() => (document.body?.innerText || "").trim());
  const beforePages = await page.browser().pages();
  const candidates = [".tips", ".q-footer-answer-tip-wrap", ".q-footer"];

  const readPopoverText = async () => {
    return await page.evaluate(() => {
      const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
      const popovers = Array.from(document.querySelectorAll(
        ".ant-popover, .ant-popover-inner, .ant-popover-inner-content, [class*='popover']"
      ));
      const text = popovers
        .map((node) => normalize(node.textContent))
        .filter((text) => text.length >= 8 && text !== "查看提示")
        .sort((a, b) => b.length - a.length)[0];
      return text || "";
    });
  };

  let opened = false;
  for (const selector of candidates) {
    const node = await page.$(selector);
    if (!node) continue;
    await page.evaluate((el) => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, node);
    await delay(400, 700);

    try {
      await page.hover(selector);
    } catch {}

    await delay(200, 400);

    try {
      const box = await node.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await delay(100, 180);
        await page.mouse.down();
        await delay(60, 120);
        await page.mouse.up();
      } else {
        await node.click();
      }
    } catch {
      await page.evaluate((el) => {
        (el as HTMLElement).click();
      }, node);
    }

    opened = true;
    await delay(800, 1500);
    const popoverText = await readPopoverText();
    if (popoverText) {
      return popoverText.slice(0, 400);
    }
  }

  if (!opened) return "";
  await delay(1200, 2200);

  const afterPages = await page.browser().pages();
  const newestPage = afterPages.length > beforePages.length ? afterPages[afterPages.length - 1] : null;
  if (newestPage && newestPage !== page) {
    await newestPage.bringToFront().catch(() => null);
    await newestPage.waitForNetworkIdle({ idleTime: 800, timeout: 5000 }).catch(() => null);
    const popupText = await newestPage.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim());
    return popupText.slice(0, 400);
  }

  const popoverText = await readPopoverText();
  if (popoverText) {
    return popoverText.slice(0, 400);
  }

  const containerText = await page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const containers = Array.from(document.querySelectorAll(
      "[role='dialog'], .ant-modal, .modal, .tips, .tip, [class*='hint'], [class*='tip'], [class*='answer-tip'], [class*='analysis']"
    ));
    const text = containers
      .map((node) => normalize(node.textContent))
      .filter((text) => text && text !== "查看提示")
      .sort((a, b) => b.length - a.length)[0];
    return text || "";
  });

  if (containerText && containerText !== "查看提示") {
    return containerText;
  }

  const afterText = await page.evaluate(() => (document.body?.innerText || "").trim());
  const normalizedBefore = normalizeQuizText(beforeText);
  const normalizedAfter = normalizeQuizText(afterText);

  if (normalizedAfter.length > normalizedBefore.length) {
    const delta = normalizedAfter.replace(normalizedBefore, "").trim();
    if (delta) {
      return delta.slice(0, 400);
    }
  }

  const hintMatch = normalizedAfter.match(/(?:提示|答案|解析)[:：]\s*(.{4,400})/);
  return hintMatch?.[1] || "";
}

function isLikelyHighlightColor(color: string): boolean {
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgb) return false;
  const r = Number(rgb[1] || 0);
  const g = Number(rgb[2] || 0);
  const b = Number(rgb[3] || 0);
  return r >= 150 && r - Math.max(g, b) >= 50;
}

export async function extractHintHighlights(page: Page): Promise<string[]> {
  const items = await page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".ant-popover-inner-content *"));
    const out: string[] = [];
    for (const node of nodes) {
      const text = normalize(node.textContent);
      if (!text || text.length > 20) continue;
      const style = getComputedStyle(node);
      const color = style.color || "";
      const weight = Number(style.fontWeight || "400");
      out.push(`${color}|||${weight}|||${text}`);
    }
    return out;
  });

  const picked: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const [color, weightRaw, text] = item.split("|||");
    const weight = Number(weightRaw || "400");
    if (!text) continue;
    if (!isLikelyHighlightColor(color || "") && weight < 600) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    picked.push(text);
  }
  return picked;
}

export async function applySuggestedAnswers(
  page: Page,
  snapshot: QuizQuestionSnapshot,
  suggestions: string[],
  delay: (min: number, max: number) => Promise<void>
): Promise<string[]> {
  if (snapshot.questionType === "blank" || suggestions.length === 0) {
    return [];
  }

  const applied = await page.evaluate((rawSuggestions) => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const stripPrefix = (value: string) => normalize(value).replace(/^[A-D][.．、]?\s*/, "");
    const getLabel = (value: string) => {
      const match = normalize(value).match(/^([A-D])[.．、]?$/i) || normalize(value).match(/^([A-D])[.．、]\s*/i);
      return (match?.[1] || "").toUpperCase();
    };
    const normalizedSuggestions = rawSuggestions.map((item) => normalize(item));
    const strippedSuggestions = normalizedSuggestions.map((item) => stripPrefix(item));
    const labelSuggestions = normalizedSuggestions.map((item) => getLabel(item)).filter(Boolean);
    const optionNodes = Array.from(document.querySelectorAll<HTMLElement>(".q-answer.choosable, .q-answer"));
    const appliedTexts: string[] = [];

    for (const node of optionNodes) {
      const text = normalize(node.textContent);
      if (!text) continue;
      const stripped = stripPrefix(text);
      const label = getLabel(text);
      const matched =
        normalizedSuggestions.includes(text) ||
        strippedSuggestions.includes(stripped) ||
        (label && labelSuggestions.includes(label));
      if (!matched) continue;

      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.click();
      appliedTexts.push(text);
    }

    return appliedTexts;
  }, suggestions);

  if (applied.length > 0) {
    await delay(600, 1000);
  }

  return applied;
}

export async function applyBlankAnswers(
  page: Page,
  suggestions: string[],
  delay: (min: number, max: number) => Promise<void>
): Promise<string[]> {
  if (suggestions.length === 0) {
    return [];
  }

  // Try to dismiss floating hint popovers before interacting with blank slots/chips.
  await page.mouse.click(48, 48).catch(() => null);
  await delay(80, 140);

  // Strategy 1: word-bank blank questions (click tokens to fill)
  // We only treat this as success when blank-slot state actually changes.
  const candidateTokens = await page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(
      [
        ".q-tag-wrap .q-tag",
        ".q-tag-wrap .tag",
        ".q-tag-wrap button",
        ".q-tag-wrap span",
        ".q-tag-wrap div",
        "[class*='tag-wrap'] .q-tag",
        "[class*='tag-wrap'] .tag",
        ".q-answers .fill-answer",
        ".fill-answer.fill-answer-click",
        ".fill-answer",
        ".q-answers .q-answer.choosable",
        ".q-answers .q-answer",
        ".q-answer.choosable",
      ].join(", ")
    ));
    const values = nodes
      .map((node) => normalize(node.textContent))
      .filter((text) => text.length > 0 && text.length <= 20 && !/^[A-D][.．、]/.test(text));
    return Array.from(new Set(values));
  });

  if (candidateTokens.length > 0) {
    const collectBlankSlots = () =>
      page.evaluate(() => {
        const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
        const isVisible = (node: HTMLElement) => {
          const rect = node.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) return false;
          const style = getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden";
        };
        const root = (document.querySelector(".q-body, .question, .q-question, .detail-body") as HTMLElement | null) || document.body;
        const pool = Array.from(root.querySelectorAll<HTMLElement>("input, textarea, [contenteditable='true'], span, div, i, b, em"));
        const slots = pool.filter((node) => {
          if (!isVisible(node)) return false;
          const cls = (node.className || "").toLowerCase();
          const text = normalize(node.textContent);
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const inHintPopover = Boolean(node.closest(".ant-popover, [class*='popover'], [class*='tooltip'], .q-help"));
          if (inHintPopover) return false;
          const hasSlotClass = /(blank|input|slot|answer|fill)/.test(cls);
          const boxLike =
            rect.width >= 16 &&
            rect.width <= 52 &&
            rect.height >= 16 &&
            rect.height <= 56 &&
            (style.borderStyle !== "none" || style.backgroundColor !== "rgba(0, 0, 0, 0)");
          const emptyLike = !text || /^[_\u3000\s（）()]+$/.test(text);
          return hasSlotClass || (boxLike && (emptyLike || text.length <= 4));
        });

        const texts = slots.map((node) => normalize(node.textContent));
        const emptyCount = texts.filter((text) => !text || /^[_\u3000\s（）()]+$/.test(text)).length;
        return {
          texts,
          emptyCount,
          nonEmptyCount: texts.length - emptyCount,
        };
      });

    const beforeState = await collectBlankSlots();

    const clickedTokens: string[] = [];
    for (const suggestion of suggestions) {
      const tokenSeq = tokenizeBlankAnswerByCandidates(suggestion, candidateTokens);
      if (tokenSeq.length === 0) continue;
      for (const token of tokenSeq) {
        const clicked = await page.evaluate((expected) => {
          const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
          const isVisible = (el: HTMLElement) => {
            const rect = el.getBoundingClientRect();
            if (rect.width < 6 || rect.height < 6) return false;
            const style = getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden";
          };
          const root = (document.querySelector(".q-body, .question, .q-question, .detail-body") as HTMLElement | null) || document.body;
          const slotNodes = Array.from(root.querySelectorAll<HTMLElement>("input, textarea, [contenteditable='true'], span, div, i, b, em"))
            .filter((item) => {
              if (!isVisible(item)) return false;
              const cls = (item.className || "").toLowerCase();
              const text = normalize(item.textContent);
              const rect = item.getBoundingClientRect();
              const style = getComputedStyle(item);
              const inHintPopover = Boolean(item.closest(".ant-popover, [class*='popover'], [class*='tooltip'], .q-help"));
              if (inHintPopover) return false;
              const hasSlotClass = /(blank|input|slot|answer|fill)/.test(cls);
              const boxLike =
                rect.width >= 16 &&
                rect.width <= 52 &&
                rect.height >= 16 &&
                rect.height <= 56 &&
                (style.borderStyle !== "none" || style.backgroundColor !== "rgba(0, 0, 0, 0)");
              const emptyLike = !text || /^[_\u3000\s（）()]+$/.test(text);
              return hasSlotClass || (boxLike && (emptyLike || text.length <= 4));
            });
          const pickSlot = slotNodes.find((item) => {
            const text = normalize(item.textContent);
            return !text || /^[_\u3000\s（）()]+$/.test(text);
          }) || slotNodes[0];
          if (pickSlot) {
            pickSlot.scrollIntoView({ behavior: "smooth", block: "center" });
            pickSlot.click();
          }

          const nodes = Array.from(document.querySelectorAll<HTMLElement>(
            [
              ".q-tag-wrap .q-tag",
              ".q-tag-wrap .tag",
              ".q-tag-wrap button",
              ".q-tag-wrap span",
              ".q-tag-wrap div",
              "[class*='tag-wrap'] .q-tag",
              "[class*='tag-wrap'] .tag",
              ".q-answers .fill-answer",
              ".fill-answer.fill-answer-click",
              ".fill-answer",
              ".q-answers .q-answer.choosable",
              ".q-answers .q-answer",
              ".q-answer.choosable",
            ].join(", ")
          ));
          const node = nodes.find((item) => normalize(item.textContent) === expected && isVisible(item));
          if (!node) return false;
          node.scrollIntoView({ behavior: "smooth", block: "center" });
          const clickable = node.closest("button, a, li, [role='button'], .q-tag, .tag, .fill-answer") as HTMLElement | null;
          const target = (clickable || node) as HTMLElement;
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          target.click?.();
          return true;
        }, token);
        if (clicked) {
          clickedTokens.push(token);
          await delay(120, 220);
        }
      }
    }

    if (clickedTokens.length > 0) {
      const afterState = await collectBlankSlots();
      const changed =
        afterState.texts.join("|") !== beforeState.texts.join("|") ||
        afterState.emptyCount < beforeState.emptyCount ||
        afterState.nonEmptyCount > beforeState.nonEmptyCount;
      await delay(500, 900);
      if (changed) {
        return suggestions;
      }
    }
  }

  const applied = await page.evaluate((rawSuggestions) => {
    const textInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='text'], input:not([type]), textarea"));
    const editableNodes = Array.from(document.querySelectorAll<HTMLElement>("[contenteditable='true']"));
    const fields = [...textInputs, ...editableNodes].filter((node) => {
      const style = getComputedStyle(node as HTMLElement);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    const appliedValues: string[] = [];
    for (let index = 0; index < Math.min(fields.length, rawSuggestions.length); index++) {
      const field = fields[index];
      if (!field) continue;
      const value = rawSuggestions[index];
      if (!value) continue;

      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.focus();
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        appliedValues.push(value);
        continue;
      }

      field.focus();
      field.textContent = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      appliedValues.push(value);
    }

    return appliedValues;
  }, suggestions);

  if (applied.length > 0) {
    await delay(600, 1000);
    return applied;
  }

  const fallbackSlots = await page.evaluate(() => {
    const inQuestion = Array.from(document.querySelectorAll<HTMLElement>(".q-body *, .question *"));
    const slots: Array<{ x: number; y: number }> = [];

    for (const node of inQuestion) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 12) continue;

      const style = getComputedStyle(node);
      const text = (node.textContent || "").replace(/\s+/g, "").trim();
      const looksUnderlined =
        style.borderBottomStyle !== "none" ||
        style.textDecorationLine.includes("underline");
      const looksBlankNode =
        text === "" ||
        text === "（）" ||
        text === "()" ||
        /^_{2,}$/.test(text) ||
        /^﹍+$/.test(text);

      if (!looksUnderlined && !looksBlankNode) continue;
      slots.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    }

    return slots.slice(0, 8);
  });

  const typed: string[] = [];
  for (let i = 0; i < Math.min(fallbackSlots.length, suggestions.length); i++) {
    const slot = fallbackSlots[i];
    if (!slot) continue;
    const answer = suggestions[i];
    if (!answer) continue;

    await page.mouse.click(slot.x, slot.y);
    await delay(120, 220);
    const editableFocused = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      return (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active.getAttribute("contenteditable") === "true"
      );
    });
    if (editableFocused) {
      await page.keyboard.down("Meta").catch(() => null);
      await page.keyboard.press("A").catch(() => null);
      await page.keyboard.up("Meta").catch(() => null);
      await page.keyboard.press("Backspace").catch(() => null);
    }
    await page.keyboard.type(answer, { delay: 30 });
    const wrote = await page.evaluate((expected) => {
      const active = document.activeElement as HTMLElement | null;
      const fromActive = (() => {
        if (!active) return false;
        const text =
          active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
            ? active.value
            : (active.textContent || "");
        return text.includes(expected);
      })();
      if (fromActive) return true;

      const stemText = (document.querySelector(".q-body")?.textContent || "").replace(/\s+/g, " ");
      return stemText.includes(expected);
    }, answer).catch(() => false);
    if (wrote) {
      typed.push(answer);
    }
    await delay(120, 220);
  }

  if (typed.length > 0) {
    await delay(500, 900);
  }

  return typed;
}

export async function previewQuestionVideo(page: Page, delay: (min: number, max: number) => Promise<void>, previewSeconds: number): Promise<void> {
  const playAttempt = await page.evaluate(async () => {
    const video = document.querySelector("video");
    if (!video) return "no_video";

    const playBtn = document.querySelector(".prism-play-btn") as HTMLElement
      || document.querySelector(".prism-big-play-btn") as HTMLElement
      || document.querySelector("[class*='play']") as HTMLElement;

    if (playBtn) {
      playBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (!video.paused) return "clicked";
    }

    try {
      await video.play();
      return "js_play";
    } catch {
      return "failed";
    }
  });

  console.log(`[测验任务] 视频题播放尝试结果：${playAttempt}`);
  await delay(previewSeconds * 1000, previewSeconds * 1000);
}

async function clickQuizAction(page: Page, labels: string[]): Promise<boolean> {
  const selectors = [".ant-btn", "button", "[role='button']", "a[role='button']"];
  for (const selector of selectors) {
    const nodes = await page.$$(selector);
    for (const node of nodes) {
      const text = await page.evaluate((el) => (el.textContent || "").replace(/\s+/g, "").trim(), node);
      if (!labels.some((label) => text.includes(label))) {
        continue;
      }
      try {
        await page.evaluate((el) => {
          (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
        }, node);
        const box = await node.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        } else {
          await node.click();
        }
        return true;
      } catch {
        try {
          await page.evaluate((el) => (el as HTMLElement).click(), node);
          return true;
        } catch {}
      }
    }
  }
  return false;
}

export async function submitCurrentAnswer(
  page: Page,
  previousSnapshot: QuizQuestionSnapshot,
  delay: (min: number, max: number) => Promise<void>
): Promise<{ submitted: boolean; advanced: boolean; finished: boolean }> {
  const movedToNextQuestion = (snapshot: QuizQuestionSnapshot) => {
    const advancedByIndex =
      snapshot.currentIndex > 0 &&
      previousSnapshot.currentIndex > 0 &&
      snapshot.currentIndex > previousSnapshot.currentIndex;
    const advancedByStem = Boolean(snapshot.stem && snapshot.stem !== previousSnapshot.stem);
    return advancedByIndex || advancedByStem;
  };

  const waitForAdvance = async (attempts: number) => {
    for (let i = 0; i < attempts; i++) {
      await delay(700, 1100);
      const snap = await readQuizQuestionSnapshot(page);
      if (movedToNextQuestion(snap)) {
        return true;
      }
    }
    return false;
  };

  const submitted = await clickQuizAction(page, ["确定", "提交", "完成"]);
  if (!submitted) {
    return { submitted: false, advanced: false, finished: false };
  }

  const extraAdvanceAttempts = previousSnapshot.questionType === "blank" ? 14 : 4;

  await delay(1200, 2000);
  const afterFirst = await readQuizQuestionSnapshot(page);
  if (movedToNextQuestion(afterFirst)) {
    return { submitted: true, advanced: true, finished: false };
  }

  const advanced = await clickQuizAction(page, ["下一题", "完成"]);
  if (!advanced) {
    if (await waitForAdvance(extraAdvanceAttempts)) {
      return { submitted: true, advanced: true, finished: false };
    }
    const bodyText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim());
    const finished =
      /本次得分|答题结果|恭喜|再来一组|继续挑战/.test(bodyText) ||
      /exam-result|exam\/result|result/.test(page.url());
    return { submitted: true, advanced: false, finished };
  }

  await delay(1000, 1800);
  const afterAdvance = await readQuizQuestionSnapshot(page);
  if (movedToNextQuestion(afterAdvance) || await waitForAdvance(previousSnapshot.questionType === "blank" ? 10 : 3)) {
    return { submitted: true, advanced: true, finished: false };
  }

  const bodyText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim());
  const finished =
    /本次得分|答题结果|恭喜|再来一组|继续挑战/.test(bodyText) ||
    /exam-result|exam\/result|result/.test(page.url());
  return { submitted: true, advanced: false, finished };
}
