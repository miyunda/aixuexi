import { loadConfig } from "../src/config";
import { BrowserEngine } from "../src/browser";

async function main() {
  const config = loadConfig();
  const engine = new BrowserEngine();

  try {
    await engine.init(config);
    const page = engine.page!;
    await page.goto("https://pc.xuexi.cn/points/my-points.html", { waitUntil: "networkidle2" });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const result = await page.evaluate(() => {
      const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();

      const blocks = Array.from(document.querySelectorAll<HTMLElement>("div, section, li, article"))
        .map((node) => {
          const text = normalize(node.textContent);
          if (!text.includes("每日答题")) return null;
          const actionNodes = Array.from(node.querySelectorAll<HTMLElement>("a, button, div, span"));
          return {
            text: text.slice(0, 240),
            tag: node.tagName,
            className: node.className,
            href: node.getAttribute("href"),
            dataHref: node.getAttribute("data-href"),
            onclick: node.getAttribute("onclick"),
            actions: actionNodes
              .map((action) => ({
                text: normalize(action.textContent).slice(0, 80),
                tag: action.tagName,
                className: action.className,
                href: action.getAttribute("href"),
                dataHref: action.getAttribute("data-href"),
                onclick: action.getAttribute("onclick"),
              }))
              .filter((action) => action.text || action.href || action.dataHref || action.onclick)
              .slice(0, 30),
          };
        })
        .filter(Boolean);

      return blocks;
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await engine.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
