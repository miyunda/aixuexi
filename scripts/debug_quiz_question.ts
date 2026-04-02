import { loadConfig } from "../src/config";
import { BrowserEngine } from "../src/browser";
import { navigateToDailyQuiz } from "../src/tasks/quiz_helpers";
import * as fs from "fs";
import * as path from "path";

function delay(min: number, max: number) {
  const ms = Math.max(min, max);
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = loadConfig();
  const engine = new BrowserEngine();

  try {
    await engine.init(config);
    const page = engine.page!;
    await navigateToDailyQuiz(page, delay);
    await delay(2000, 2000);

    const hintNodes = await page.$$(".tips, .q-footer-answer-tip-wrap, .q-footer-click-tip");
    for (const node of hintNodes) {
      const text = await page.evaluate((el) => (el.textContent || "").replace(/\s+/g, "").trim(), node);
      const className = await page.evaluate((el) => (el as HTMLElement).className || "", node);
      if (!text.includes("查看提示") && !className.includes("tip")) continue;
      try {
        await node.click();
      } catch {
        await page.evaluate((el) => {
          (el as HTMLElement).click();
        }, node);
      }
      break;
    }

    await delay(1500, 1500);
    const screenshotPath = path.join(process.cwd(), "tmp", "debug-quiz-hint.png");
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const result = await page.evaluate(() => {
      const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();

      const optionLike = Array.from(document.querySelectorAll<HTMLElement>("label, li, div, span, p"))
        .map((node) => ({
          tag: node.tagName,
          className: node.className,
          text: normalize(node.textContent).slice(0, 120),
        }))
        .filter((node) => /(^[A-D][.．、]?$)|(^[A-D][.．、]\s)|正确|错误|对|错/.test(node.text) || node.className.includes("option") || node.className.includes("choice"))
        .slice(0, 80);

      const hintLike = Array.from(document.querySelectorAll<HTMLElement>("button, a, span, div"))
        .map((node) => ({
          tag: node.tagName,
          className: node.className,
          text: normalize(node.textContent).slice(0, 120),
          rect: (() => {
            const rect = node.getBoundingClientRect();
            return {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          })(),
        }))
        .filter((node) => node.text.includes("提示") || node.className.includes("tip") || node.className.includes("hint"))
        .slice(0, 60);

      const expandedLike = Array.from(document.querySelectorAll<HTMLElement>("div, span, p, li"))
        .map((node) => ({
          tag: node.tagName,
          className: node.className,
          text: normalize(node.textContent).slice(0, 240),
          style: {
            display: getComputedStyle(node).display,
            visibility: getComputedStyle(node).visibility,
            opacity: getComputedStyle(node).opacity,
            height: getComputedStyle(node).height,
          },
        }))
        .filter((node) => {
          return (
            node.text.length >= 8 &&
            (
              node.className.includes("tip") ||
              node.className.includes("answer") ||
              node.className.includes("analysis") ||
              node.text.includes("提示：") ||
              node.text.includes("答案：") ||
              node.text.includes("正确答案")
            )
          );
        })
        .slice(0, 80);

      return {
        url: window.location.href,
        title: document.title,
        bodyText: normalize(document.body?.innerText).slice(0, 1200),
        optionLike,
        hintLike,
        expandedLike,
        inputs: Array.from(document.querySelectorAll("input, textarea, video")).map((node) => ({
          tag: node.tagName,
          type: (node as HTMLInputElement).type || "",
          className: (node as HTMLElement).className || "",
        })),
      };
    });

    console.log(JSON.stringify({ ...result, screenshotPath }, null, 2));
  } finally {
    await engine.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
