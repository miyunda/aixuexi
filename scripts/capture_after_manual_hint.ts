import { loadConfig } from "../src/config";
import { BrowserEngine } from "../src/browser";
import { navigateToDailyQuiz } from "../src/tasks/quiz_helpers";
import * as fs from "fs";
import * as path from "path";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEnter(message: string): Promise<void> {
  process.stdout.write(`${message}\n`);
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });
}

async function main() {
  const config = loadConfig();
  const engine = new BrowserEngine();

  try {
    await engine.init(config);
    const page = engine.page!;
    await navigateToDailyQuiz(page, async (min, max) => delay(Math.max(min, max)));
    await delay(2000);

    const questionInfo = await page.evaluate(() => {
      const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
      return {
        url: window.location.href,
        title: document.title,
        question: normalize(document.querySelector<HTMLElement>(".q-body")?.textContent) || normalize(document.body?.innerText).slice(0, 200),
      };
    });

    console.log("=== 已停在每日答题第一页 ===");
    console.log(JSON.stringify(questionInfo, null, 2));
    await waitForEnter("【请在浏览器里手动点击一次“查看提示”，确认页面已经展开提示后，在这里按 Enter】");

    await delay(1000);
    const screenshotPath = path.join(process.cwd(), "tmp", "manual-hint-expanded.png");
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const snapshot = await page.evaluate(() => {
      const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("div, span, p, li"))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            tag: node.tagName,
            className: node.className,
            text: normalize(node.textContent).slice(0, 400),
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
        })
        .filter((node) => node.text.length >= 4)
        .slice(0, 400);

      return {
        url: window.location.href,
        title: document.title,
        bodyText: normalize(document.body?.innerText).slice(0, 2000),
        matchingNodes: nodes.filter((node) =>
          node.className.includes("tip") ||
          node.className.includes("answer") ||
          node.className.includes("analysis") ||
          node.text.includes("提示") ||
          node.text.includes("答案") ||
          node.text.includes("正确") ||
          node.text.includes("错误")
        ),
      };
    });

    console.log(JSON.stringify({ ...snapshot, screenshotPath }, null, 2));
    await waitForEnter("【抓取完成。如需关闭浏览器，请在这里按 Enter 结束】");
  } finally {
    await engine.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
