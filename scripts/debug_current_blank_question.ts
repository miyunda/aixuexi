import { loadConfig } from "../src/config";
import { BrowserEngine } from "../src/browser";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const config = loadConfig();
  const engine = new BrowserEngine();

  try {
    await engine.init(config);
    const page = engine.page!;
    await page.waitForFunction(() => window.location.href.includes("exam-practice"), { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 1500));

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

    const screenshotPath = path.join(process.cwd(), "tmp", "debug-current-blank-question.png");
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(JSON.stringify({ ...result, screenshotPath }, null, 2));
  } finally {
    await engine.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
