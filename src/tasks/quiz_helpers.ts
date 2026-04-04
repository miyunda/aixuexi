import type { Page } from "puppeteer-core";

export type QuizQuestionType = "single" | "multiple" | "single_blank" | "multi_blank" | "unknown";

export interface QuizQuestionSnapshot {
  stem: string;
  options: string[];
  questionType: QuizQuestionType;
  blankCount: number;
  hasVideo: boolean;
  currentIndex: number;
  totalQuestions: number;
}

export function isBlankQuestionType(questionType: QuizQuestionType): boolean {
  return questionType === "single_blank" || questionType === "multi_blank";
}

interface VisualBlankSlot {
  text: string;
  x: number;
  y: number;
}

export function resolveQuestionTypeFromSnapshot(params: {
  parsedQuestionType: QuizQuestionType;
  parsedOptionsCount: number;
  selectorOptionsCount: number;
  inputBlankCount: number;
  visualBlankCount: number;
}): QuizQuestionType {
  const {
    parsedQuestionType,
    parsedOptionsCount,
    selectorOptionsCount,
    inputBlankCount,
    visualBlankCount,
  } = params;

  const optionCount = Math.max(parsedOptionsCount, selectorOptionsCount);
  const hasChoiceSignals =
    optionCount >= 2 || parsedQuestionType === "single" || parsedQuestionType === "multiple";

  if (hasChoiceSignals) {
    if (parsedQuestionType === "single" || parsedQuestionType === "multiple") {
      return parsedQuestionType;
    }
    return optionCount > 2 ? "multiple" : "single";
  }

  if (inputBlankCount > 0 || isBlankQuestionType(parsedQuestionType) || visualBlankCount > 0) {
    const blankCount = Math.max(inputBlankCount, visualBlankCount);
    return blankCount <= 1 ? "single_blank" : "multi_blank";
  }

  return parsedQuestionType;
}

export function hasAdvancedToDifferentQuestion(
  previousSnapshot: Pick<QuizQuestionSnapshot, "stem" | "currentIndex">,
  nextSnapshot: Pick<QuizQuestionSnapshot, "stem" | "currentIndex">
): boolean {
  const advancedByIndex =
    nextSnapshot.currentIndex > 0 &&
    previousSnapshot.currentIndex > 0 &&
    nextSnapshot.currentIndex > previousSnapshot.currentIndex;
  const advancedByStem = Boolean(nextSnapshot.stem && nextSnapshot.stem !== previousSnapshot.stem);
  return advancedByIndex || advancedByStem;
}

interface ParsedQuestionText {
  stem: string;
  options: string[];
  questionType: QuizQuestionType;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.round(randomBetween(min, max));
}

async function humanPause(delay: (min: number, max: number) => Promise<void>, min: number, max: number): Promise<void> {
  await delay(min, max);
}

async function moveMouseHumanly(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(
    x + randomBetween(-3, 3),
    y + randomBetween(-3, 3),
    { steps: randomInt(10, 22) }
  );
  await page.mouse.move(
    x + randomBetween(-1.5, 1.5),
    y + randomBetween(-1.5, 1.5),
    { steps: randomInt(4, 10) }
  );
}

async function humanClickPoint(page: Page, x: number, y: number, delay: (min: number, max: number) => Promise<void>): Promise<void> {
  await moveMouseHumanly(page, x, y);
  await humanPause(delay, 70, 160);
  await page.mouse.down();
  await humanPause(delay, 45, 110);
  await page.mouse.up();
}

async function humanClickElement(
  page: Page,
  element: { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number; } | null>; evaluate: <T>(pageFunction: (element: Element) => T | Promise<T>) => Promise<T>; },
  delay: (min: number, max: number) => Promise<void>
): Promise<boolean> {
  await element.evaluate((node) => {
    (node as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }).catch(() => null);
  await humanPause(delay, 300, 650);
  const box = await element.boundingBox().catch(() => null);
  if (!box) return false;

  const insetX = Math.max(4, Math.min(box.width * 0.25, 16));
  const insetY = Math.max(4, Math.min(box.height * 0.25, 12));
  const x = randomBetween(box.x + insetX, box.x + box.width - insetX);
  const y = randomBetween(box.y + insetY, box.y + box.height - insetY);
  await humanClickPoint(page, x, y, delay);
  return true;
}

async function humanTypeText(page: Page, text: string, delay: (min: number, max: number) => Promise<void>): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(55, 135) });
    if (/[,，。；：]/.test(char)) {
      await humanPause(delay, 120, 260);
    } else if (Math.random() < 0.18) {
      await humanPause(delay, 60, 180);
    }
  }
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

function inferSingleBlankByLcs(stem: string, hint: string): string {
  const a = normalizeQuizText(stem).replace(/\s+/g, "");
  const b = normalizeQuizText(hint).replace(/\s+/g, "");
  if (!a || !b || a === b) return "";

  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const matchedHintIndexes = new Set<number>();
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matchedHintIndexes.add(j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const fragments: string[] = [];
  let current = "";
  for (let index = 0; index < b.length; index++) {
    if (matchedHintIndexes.has(index)) {
      if (current) {
        fragments.push(current);
        current = "";
      }
    } else {
      current += b[index];
    }
  }
  if (current) {
    fragments.push(current);
  }

  const candidates = fragments
    .map((item) => trimAnswerFragment(item))
    .filter((item) =>
      item.length > 0 &&
      item.length <= 16 &&
      !/[，。；：！？]/.test(item) &&
      !/^\d{4}年/.test(item) &&
      !a.includes(item)
    );

  if (candidates.length === 0) return "";
  return Array.from(new Set(candidates)).sort((left, right) => left.length - right.length)[0] || "";
}

export function pickSingleBlankFromHighlights(stem: string, hintText: string, highlighted: string[]): string {
  const normalizedHint = normalizeQuizText(hintText).replace(/\s+/g, "");
  const candidates = Array.from(new Set(
    highlighted
      .map((item) => normalizeQuizText(item).replace(/[“"《》”]/g, "").replace(/\s+/g, ""))
      .filter((item) => item.length > 0 && item.length <= 16 && !/[，。；：]/.test(item))
  ));
  if (!normalizedHint || candidates.length === 0) return "";
  if (candidates.length === 1) return candidates[0] || "";

  const shortestLength = Math.min(...candidates.map((item) => item.length));
  const narrowed = candidates.filter((item) => item.length <= shortestLength + 1);
  return narrowed.sort((a, b) => normalizedHint.lastIndexOf(b) - normalizedHint.lastIndexOf(a))[0] || candidates[0] || "";
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

export function sortVisualSlots<T extends { x: number; y: number }>(slots: T[]): T[] {
  const rowThreshold = 12;
  return [...slots].sort((a, b) => {
    if (Math.abs(a.y - b.y) <= rowThreshold) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });
}

function normalizeBlankSlotText(text: string): string {
  return normalizeQuizText(text).replace(/\s+/g, "");
}

function isBlankSlotEmpty(text: string): boolean {
  return !text || /^[_\u3000\s（）()]+$/.test(text);
}

export function deriveOrderedBlankSuggestions(stem: string, hintText: string, blankCount: number): string[] {
  const normalizedStem = normalizeQuizText(stem);
  const normalizedHint = normalizeQuizText(hintText);
  if (!normalizedStem || !normalizedHint || blankCount <= 0) {
    return [];
  }

  const parts = normalizedStem.split(BLANK_PATTERN).map((part) => normalizeQuizText(part));
  if (parts.length < 2) {
    const diffAnswer = inferSingleBlankByDiff(normalizedStem, normalizedHint) || inferSingleBlankByLcs(normalizedStem, normalizedHint);
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
  else if (normalized.includes("填空题")) questionType = "single_blank";

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

function dedupeTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts.map((item) => normalizeQuizText(item)).filter(Boolean)) {
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
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
    await humanClickElement(page, target, delay);

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

  await humanPause(delay, 400, 900);

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
    const isVisible = (node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    };
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
    const inputBlankCount = document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']").length;
    const root = (document.querySelector(".q-body, .question, .q-question, .detail-body") as HTMLElement | null) || document.body;
    const visualBlankCount = Array.from(root.querySelectorAll<HTMLElement>("input, textarea, [contenteditable='true'], span, div, i, b, em"))
      .filter((node) => {
        if (!isVisible(node)) return false;
        const cls = (node.className || "").toLowerCase();
        const text = normalize(node.textContent);
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const inHintPopover = Boolean(node.closest(".ant-popover, [class*='popover'], [class*='tooltip'], .q-help"));
        const inWordBank = Boolean(node.closest(".q-tag-wrap, [class*='tag-wrap'], .q-answers"));
        if (inHintPopover || inWordBank) return false;
        const hasSlotClass = /(blank|input|slot|answer|fill)/.test(cls);
        const emptyLike = !text || /^[_\u3000\s（）()]+$/.test(text);
        if (hasSlotClass) {
          return emptyLike || text.length <= 12;
        }
        const boxLike =
          rect.width >= 12 &&
          rect.width <= 72 &&
          rect.height >= 16 &&
          rect.height <= 64 &&
          (style.borderBottomStyle !== "none" || style.borderStyle !== "none");
        return boxLike && emptyLike;
      }).length;
    const blankCount = Math.max(inputBlankCount, visualBlankCount);
    const hasVideo = !!document.querySelector("video, .prism-player, .video-js, [class*='video']");
    return {
      rawText,
      blankCount,
      inputBlankCount,
      visualBlankCount,
      hasVideo,
      selectorOptions,
      selectorStem,
      currentIndex: progressMatch ? Number(progressMatch[1]) : 0,
      totalQuestions: progressMatch ? Number(progressMatch[2]) : 0,
    };
  });

  const parsed = parseQuestionFromRawText(snapshot.rawText);
  const questionType = resolveQuestionTypeFromSnapshot({
    parsedQuestionType: parsed.questionType,
    parsedOptionsCount: parsed.options.length,
    selectorOptionsCount: snapshot.selectorOptions.length,
    inputBlankCount: snapshot.inputBlankCount,
    visualBlankCount: snapshot.visualBlankCount,
  });
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
      const clicked = await humanClickElement(page, node, delay);
      if (!clicked) {
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
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".ant-popover-inner-content *, .ant-popover *"));
    const out: string[] = [];
    for (const node of nodes) {
      const text = normalize(node.textContent);
      if (!text || text.length > 20) continue;
      if (node.children.length > 0) continue;
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

async function readOptionSelectionState(page: Page, expectedText: string): Promise<boolean> {
  return await page.evaluate((targetText) => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".q-answer.choosable, .q-answer"));
    const matchingNodes = nodes.filter((item) => normalize(item.textContent) === targetText);
    if (matchingNodes.length === 0) return false;

    const isSelectedLike = (element: HTMLElement | null) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const classText = (element.className || "").toLowerCase();
      const ariaChecked = element.getAttribute("aria-checked");
      const ariaSelected = element.getAttribute("aria-selected");
      const borderColor = style.borderColor || "";
      const textColor = style.color || "";
      const backgroundColor = style.backgroundColor || "";
      const boxShadow = style.boxShadow || "";
      const highlightedBorder =
        /rgb\(210,\s*65,\s*50\)|rgb\(217,\s*83,\s*79\)|rgb\(255,\s*77,\s*79\)|rgb\(230,\s*95,\s*64\)|rgb\(186,\s*158,\s*131\)/i.test(borderColor);
      const highlightedText =
        /rgb\(210,\s*65,\s*50\)|rgb\(217,\s*83,\s*79\)|rgb\(255,\s*77,\s*79\)|rgb\(230,\s*95,\s*64\)|rgb\(186,\s*158,\s*131\)/i.test(textColor);
      const highlightedBackground =
        /rgb\(255,\s*245,\s*245\)|rgb\(255,\s*240,\s*240\)|rgb\(255,\s*237,\s*237\)|rgb\(255,\s*250,\s*250\)/i.test(backgroundColor);
      const highlightedShadow =
        /rgb\(210,\s*65,\s*50\)|rgb\(217,\s*83,\s*79\)|rgb\(255,\s*77,\s*79\)|rgb\(230,\s*95,\s*64\)|rgb\(186,\s*158,\s*131\)/i.test(boxShadow);

      return (
        ariaChecked === "true" ||
        ariaSelected === "true" ||
        /(checked|selected|active|current|chosen)/.test(classText) ||
        highlightedBorder ||
        highlightedText ||
        highlightedBackground ||
        highlightedShadow
      );
    };

    return matchingNodes.some((node) => {
      if (isSelectedLike(node)) return true;

      const input = node.querySelector<HTMLInputElement>("input[type='radio'], input[type='checkbox']");
      if (input?.checked) return true;

      const descendants = Array.from(node.querySelectorAll<HTMLElement>("input, label, span, div, i"));
      if (descendants.some((item) => {
        if (item instanceof HTMLInputElement && item.checked) return true;
        return isSelectedLike(item);
      })) {
        return true;
      }

      const parent = node.parentElement;
      const grandParent = parent?.parentElement || null;
      return isSelectedLike(parent) || isSelectedLike(grandParent);
    });
  }, expectedText);
}

async function forceOptionSelection(
  node: {
    boundingBox: () => Promise<{ x: number; y: number; width: number; height: number; } | null>;
    evaluate: <T>(pageFunction: (element: Element) => T | Promise<T>) => Promise<T>;
  }
): Promise<void> {
  await node.evaluate((element) => {
    const target = element as HTMLElement;
    const clickable =
      target.closest("label, button, [role='radio'], [role='checkbox'], .q-answer, .choosable") as HTMLElement | null;
    const primary = clickable || target;
    primary.click();

    const nested =
      primary.querySelector<HTMLElement>("input, label, button, [role='radio'], [role='checkbox'], span, i") ||
      target.querySelector<HTMLElement>("input, label, button, [role='radio'], [role='checkbox'], span, i");
    nested?.click();

    const input = (nested instanceof HTMLInputElement ? nested : primary.querySelector<HTMLInputElement>("input")) || null;
    if (input) {
      input.click();
      input.checked = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }).catch(() => null);
}

async function findOptionNodeByText(
  page: Page,
  expectedText: string
): Promise<{
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number; } | null>;
  evaluate: <T>(pageFunction: (element: Element) => T | Promise<T>) => Promise<T>;
} | null> {
  const optionNodes = await page.$$(".q-answer.choosable, .q-answer");
  let fallback: typeof optionNodes[number] | null = null;

  for (const node of optionNodes) {
    const text = await page.evaluate((el) => (el.textContent || "").replace(/\s+/g, " ").trim(), node).catch(() => "");
    if (normalizeQuizText(text) !== expectedText) continue;
    fallback = fallback || node;
    const box = await node.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      return node;
    }
  }

  return fallback;
}

export async function applySuggestedAnswers(
  page: Page,
  snapshot: QuizQuestionSnapshot,
  suggestions: string[],
  delay: (min: number, max: number) => Promise<void>
): Promise<string[]> {
  if (isBlankQuestionType(snapshot.questionType) || suggestions.length === 0) {
    return [];
  }

  const matchedTexts = dedupeTexts(matchSuggestedOptions(snapshot.options, suggestions));
  const applied: string[] = [];

  for (const text of matchedTexts) {
    const alreadySelected = await readOptionSelectionState(page, text).catch(() => false);
    if (alreadySelected) {
      applied.push(text);
      continue;
    }

    const node = await findOptionNodeByText(page, text);
    if (!node) continue;

    let selected = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await humanClickElement(page, node, delay).catch(() => false);
      await humanPause(delay, 220 + attempt * 80, 520 + attempt * 120);
      selected = await readOptionSelectionState(page, text).catch(() => false);
      if (!selected) {
        await forceOptionSelection(node);
        await humanPause(delay, 120, 260);
        selected = await readOptionSelectionState(page, text).catch(() => false);
      }
      if (selected) break;
    }

    if (selected) {
      applied.push(text);
    }
  }

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
  await humanClickPoint(page, randomBetween(28, 72), randomBetween(28, 72), delay).catch(() => null);
  await delay(80, 140);

  // Strategy 1: word-bank blank questions (click tokens to fill)
  // We only treat this as success when blank-slot state actually changes.
  const blankTokenSelector = [
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
  ].join(", ");

  const candidateTokens = await page.evaluate((selector) => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const values = nodes
      .map((node) => normalize(node.textContent))
      .filter((text) => text.length > 0 && text.length <= 20 && !/^[A-D][.．、]/.test(text));
    return Array.from(new Set(values));
  }, blankTokenSelector);

  if (candidateTokens.length > 0) {
    const triggerBlankToken = async (tokenText: string): Promise<boolean> => {
      const domClicked = await page.evaluate(({ selector, expected }) => {
        const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
        const isVisible = (el: HTMLElement) => {
          const rect = el.getBoundingClientRect();
          if (rect.width < 6 || rect.height < 6) return false;
          const style = getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden";
        };
        const fireMouse = (target: HTMLElement, type: string) => {
          target.dispatchEvent(new MouseEvent(type, {
            view: window,
            bubbles: true,
            cancelable: true,
            composed: true,
          }));
        };
        const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
        const node = nodes.find((item) => normalize(item.textContent) === expected && isVisible(item));
        if (!node) return false;
        node.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
        const clickable = node.closest("button, a, li, [role='button'], .q-tag, .tag, .fill-answer, .q-answer") as HTMLElement | null;
        const target = clickable || node;
        fireMouse(target, "mousedown");
        fireMouse(target, "mouseup");
        fireMouse(target, "click");
        return true;
      }, { selector: blankTokenSelector, expected: tokenText }).catch(() => false);

      if (domClicked) {
        await delay(140, 320);
        return true;
      }

      const tokenPoint = await findTokenPoint(tokenText);
      if (tokenPoint) {
        await humanClickPoint(page, tokenPoint.x, tokenPoint.y, delay).catch(() => null);
        await delay(140, 320);
        return true;
      }

      return false;
    };

    const collectBlankSlots = async (): Promise<{
      slots: VisualBlankSlot[];
      texts: string[];
      emptyCount: number;
      nonEmptyCount: number;
    }> => {
      const slots = await page.evaluate(() => {
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
          const inWordBank = Boolean(node.closest(".q-tag-wrap, [class*='tag-wrap'], .q-answers"));
          if (inHintPopover || inWordBank) return false;
          const hasSlotClass = /(blank|input|slot|answer|fill)/.test(cls);
          const boxLike =
            rect.width >= 12 &&
            rect.width <= 160 &&
            rect.height >= 16 &&
            rect.height <= 64 &&
            (style.borderBottomStyle !== "none" || style.borderStyle !== "none" || style.backgroundColor !== "rgba(0, 0, 0, 0)");
          const emptyLike = !text || /^[_\u3000\s（）()]+$/.test(text);
          return hasSlotClass || (boxLike && (emptyLike || text.length <= 12));
        });

        return slots.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            text: normalize(node.textContent),
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        });
      });
      const orderedSlots = sortVisualSlots(slots);
      const texts = orderedSlots.map((slot) => slot.text);
      const emptyCount = texts.filter((text) => isBlankSlotEmpty(text)).length;
      return {
        slots: orderedSlots,
        texts,
        emptyCount,
        nonEmptyCount: texts.length - emptyCount,
      };
    };

    const findTokenPoint = async (expected: string) =>
      page.evaluate(({ selector, tokenText }) => {
        const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
        const isVisible = (el: HTMLElement) => {
          const rect = el.getBoundingClientRect();
          if (rect.width < 6 || rect.height < 6) return false;
          const style = getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden";
        };
        const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
        const node = nodes.find((item) => normalize(item.textContent) === tokenText && isVisible(item));
        if (!node) return null;
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        const clickable = node.closest("button, a, li, [role='button'], .q-tag, .tag, .fill-answer") as HTMLElement | null;
        const target = (clickable || node) as HTMLElement;
        const rect = target.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }, { selector: blankTokenSelector, tokenText: expected });

    const beforeState = await collectBlankSlots();
    const appliedTokens: string[] = [];
    for (const suggestion of suggestions) {
      const tokenSeq = tokenizeBlankAnswerByCandidates(suggestion, candidateTokens);
      if (tokenSeq.length === 0) continue;

      for (const token of tokenSeq) {
        const slotState = await collectBlankSlots();
        const beforeEmptySlots = slotState.slots.filter((slot) => isBlankSlotEmpty(slot.text));
        const targetSlot = beforeEmptySlots[0];
        if (targetSlot) {
          await humanClickPoint(page, targetSlot.x, targetSlot.y, delay).catch(() => null);
          await humanPause(delay, 100, 220);
        }

        const clickedToken = await triggerBlankToken(token);
        if (!clickedToken) {
          continue;
        }

        const afterTokenState = await collectBlankSlots();
        const afterEmptySlots = afterTokenState.slots.filter((slot) => isBlankSlotEmpty(slot.text));
        const newlyFilledSlotIndex = slotState.slots.findIndex((slot, index) => {
          const beforeText = normalizeBlankSlotText(slot.text);
          const afterText = normalizeBlankSlotText(afterTokenState.slots[index]?.text || "");
          return isBlankSlotEmpty(beforeText) && afterText === token;
        });
        let slotChanged =
          afterTokenState.texts.join("|") !== slotState.texts.join("|") ||
          afterTokenState.emptyCount < slotState.emptyCount ||
          afterTokenState.nonEmptyCount > slotState.nonEmptyCount;
        let tokenVisibleInSlots = afterTokenState.texts.some((text) => normalizeBlankSlotText(text) === token);
        let targetConsumed =
          afterEmptySlots.length < beforeEmptySlots.length ||
          newlyFilledSlotIndex >= 0;

        if (!targetConsumed && !tokenVisibleInSlots) {
          if (targetSlot) {
            await humanClickPoint(page, targetSlot.x, targetSlot.y, delay).catch(() => null);
            await humanPause(delay, 100, 220);
          }
          const retried = await triggerBlankToken(token);
          if (retried) {
            const retryState = await collectBlankSlots();
            const retryEmptySlots = retryState.slots.filter((slot) => isBlankSlotEmpty(slot.text));
            slotChanged =
              retryState.texts.join("|") !== slotState.texts.join("|") ||
              retryState.emptyCount < slotState.emptyCount ||
              retryState.nonEmptyCount > slotState.nonEmptyCount;
            tokenVisibleInSlots = retryState.texts.some((text) => normalizeBlankSlotText(text) === token);
            targetConsumed =
              retryEmptySlots.length < beforeEmptySlots.length ||
              slotState.slots.findIndex((slot, index) => {
                const beforeText = normalizeBlankSlotText(slot.text);
                const afterText = normalizeBlankSlotText(retryState.slots[index]?.text || "");
                return isBlankSlotEmpty(beforeText) && afterText === token;
              }) >= 0;
          }
        }

        if ((slotChanged && targetConsumed) || tokenVisibleInSlots) {
          appliedTokens.push(token);
        }
      }
    }

    if (appliedTokens.length > 0) {
      const afterState = await collectBlankSlots();
      const changed =
        afterState.texts.join("|") !== beforeState.texts.join("|") ||
        afterState.emptyCount < beforeState.emptyCount ||
        afterState.nonEmptyCount > beforeState.nonEmptyCount;
      await delay(500, 900);
      if (changed) {
        return appliedTokens;
      }
    }
  }

  const fields = await page.$$("input[type='text'], input:not([type]), textarea, [contenteditable='true']");
  const applied: string[] = [];

  for (let index = 0; index < Math.min(fields.length, suggestions.length); index++) {
    const field = fields[index];
    const value = suggestions[index];
    if (!field || !value) continue;

    const clicked = await humanClickElement(page, field, delay).catch(() => false);
    if (!clicked) continue;
    await humanPause(delay, 100, 240);
    await page.keyboard.down("Meta").catch(() => null);
    await page.keyboard.press("A").catch(() => null);
    await page.keyboard.up("Meta").catch(() => null);
    await page.keyboard.press("Backspace").catch(() => null);
    await humanPause(delay, 80, 180);
    await humanTypeText(page, value, delay);
    applied.push(value);
    await humanPause(delay, 180, 340);
  }

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

    await humanClickPoint(page, slot.x, slot.y, delay);
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
    await humanTypeText(page, answer, delay);
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
      return false;
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
  let playAttempt = "no_video";
  const playBtn = await page.$(".prism-play-btn, .prism-big-play-btn, [class*='play']");
  const videoExists = await page.$("video");

  if (playBtn && videoExists) {
    const clicked = await humanClickElement(page, playBtn, delay).catch(() => false);
    await humanPause(delay, 700, 1100);
    const paused = await page.evaluate(() => {
      const video = document.querySelector("video");
      return video ? (video as HTMLVideoElement).paused : true;
    }).catch(() => true);
    playAttempt = clicked && !paused ? "clicked" : "uncertain";
  } else if (videoExists) {
    playAttempt = await page.evaluate(async () => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      if (!video) return "no_video";
      try {
        await video.play();
        return "js_play";
      } catch {
        return "failed";
      }
    });
  }

  console.log(`[测验任务] 视频题播放尝试结果：${playAttempt}`);
  await delay(previewSeconds * 1000, previewSeconds * 1000);
}

async function clickQuizAction(page: Page, labels: string[], delay: (min: number, max: number) => Promise<void>): Promise<boolean> {
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
        const clicked = await humanClickElement(page, node, delay);
        if (!clicked) {
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
  const waitForAdvance = async (attempts: number) => {
    for (let i = 0; i < attempts; i++) {
      await delay(700, 1100);
      const snap = await readQuizQuestionSnapshot(page);
      if (hasAdvancedToDifferentQuestion(previousSnapshot, snap)) {
        return true;
      }
    }
    return false;
  };

  const submitted = await clickQuizAction(page, ["确定", "提交", "完成"], delay);
  if (!submitted) {
    return { submitted: false, advanced: false, finished: false };
  }

  const extraAdvanceAttempts = isBlankQuestionType(previousSnapshot.questionType) ? 14 : 4;

  await delay(1200, 2000);
  const afterFirst = await readQuizQuestionSnapshot(page);
  if (hasAdvancedToDifferentQuestion(previousSnapshot, afterFirst)) {
    return { submitted: true, advanced: true, finished: false };
  }

  const advanced = await clickQuizAction(page, ["下一题", "完成"], delay);
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
  if (hasAdvancedToDifferentQuestion(previousSnapshot, afterAdvance) || await waitForAdvance(isBlankQuestionType(previousSnapshot.questionType) ? 10 : 3)) {
    return { submitted: true, advanced: true, finished: false };
  }

  const bodyText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim());
  const finished =
    /本次得分|答题结果|恭喜|再来一组|继续挑战/.test(bodyText) ||
    /exam-result|exam\/result|result/.test(page.url());
  return { submitted: true, advanced: false, finished };
}
