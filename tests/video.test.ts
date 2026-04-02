import { describe, expect, test } from "bun:test";
import { extractVideoLinksFromHtml } from "../src/tasks/video_helpers";

describe("video helpers", () => {
  test("extracts unique lgpage detail links from html", () => {
    const html = `
      <div>
        https://www.xuexi.cn/lgpage/detail/index.html?id=123
        <span>https://www.xuexi.cn/lgpage/detail/index.html?id=456</span>
        https://www.xuexi.cn/lgpage/detail/index.html?id=123
      </div>
    `;

    expect(extractVideoLinksFromHtml(html)).toEqual([
      "https://www.xuexi.cn/lgpage/detail/index.html?id=123",
      "https://www.xuexi.cn/lgpage/detail/index.html?id=456",
    ]);
  });

  test("returns empty list when html contains no video detail links", () => {
    expect(extractVideoLinksFromHtml("<div>no matches here</div>")).toEqual([]);
  });
});
