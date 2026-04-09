import { loadConfig } from "../src/config";
import { BrowserEngine } from "../src/browser";
import {
  applySuggestedAnswers,
  deriveChoiceSuggestions,
  matchSuggestedOptions,
  navigateToDailyQuiz,
  openHintAndExtract,
  readQuizQuestionSnapshot,
} from "../src/tasks/quiz_helpers";

function delay(min: number, max: number) {
  const ms = Math.max(min, max);
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function dumpOptionState(page: NonNullable<BrowserEngine["page"]>) {
  return await page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const colorKeys = ["borderColor", "backgroundColor", "color", "boxShadow"] as const;

    return Array.from(document.querySelectorAll<HTMLElement>(".q-answer, .q-answer.choosable")).map((node, index) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const parent = node.parentElement;
      const input = node.querySelector<HTMLInputElement>("input");
      const descendants = Array.from(node.querySelectorAll<HTMLElement>("input, label, span, div, i")).slice(0, 8);

      return {
        index,
        text: normalize(node.textContent),
        className: node.className || "",
        ariaChecked: node.getAttribute("aria-checked"),
        ariaSelected: node.getAttribute("aria-selected"),
        checked: input?.checked ?? null,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        style: Object.fromEntries(colorKeys.map((key) => [key, style[key]])),
        parent: parent ? {
          className: parent.className || "",
          ariaChecked: parent.getAttribute("aria-checked"),
          ariaSelected: parent.getAttribute("aria-selected"),
        } : null,
        descendants: descendants.map((item) => {
          const descendantStyle = getComputedStyle(item);
          return {
            tag: item.tagName,
            text: normalize(item.textContent).slice(0, 50),
            className: item.className || "",
            ariaChecked: item.getAttribute("aria-checked"),
            ariaSelected: item.getAttribute("aria-selected"),
            checked: item instanceof HTMLInputElement ? item.checked : null,
            style: Object.fromEntries(colorKeys.map((key) => [key, descendantStyle[key]])),
          };
        }),
      };
    });
  });
}

async function main() {
  const config = loadConfig();
  const engine = new BrowserEngine();

  try {
    await engine.init(config);
    const page = engine.page!;
    await navigateToDailyQuiz(page, delay);
    await delay(1500, 1500);

    const snapshot = await readQuizQuestionSnapshot(page);
    const hintText = await openHintAndExtract(page, delay);
    const suggestions = deriveChoiceSuggestions(snapshot.options, hintText);
    const matched = matchSuggestedOptions(snapshot.options, suggestions);
    const before = await dumpOptionState(page);
    const applied = await applySuggestedAnswers(page, snapshot, suggestions, delay);
    await delay(800, 800);
    const after = await dumpOptionState(page);

    console.log(JSON.stringify({
      url: page.url(),
      stem: snapshot.stem,
      questionType: snapshot.questionType,
      options: snapshot.options,
      hintText,
      suggestions,
      matched,
      applied,
      before,
      after,
    }, null, 2));
  } finally {
    await engine.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
