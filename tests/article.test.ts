import { describe, expect, test } from "bun:test";
import { extractArticleTitle, isCandidateArticleUrl, isSeriesDirectoryShape, isVideoDominatedArticleShape, looksLikeArticleSeriesSectionTitle, looksLikeArticleTitle, normalizeArticleSeriesTitle, normalizeArticleUrl } from "../src/tasks/article_helpers";

describe("isCandidateArticleUrl", () => {
  test("accepts real article-style urls", () => {
    expect(isCandidateArticleUrl("https://article.xuexi.cn/articles/2026-03/30/c1234567890abcdef.html")).toBe(true);
    expect(isCandidateArticleUrl("https://article.xuexi.cn/articles/index.html?art_id=123")).toBe(true);
    expect(isCandidateArticleUrl("https://www.xuexi.cn/lgpage/detail/index.html?id=123")).toBe(true);
    expect(isCandidateArticleUrl("https://www.xuexi.cn/abc/def/detail.html")).toBe(true);
  });

  test("rejects channel, home, and external pages", () => {
    expect(isCandidateArticleUrl("https://www.xuexi.cn/")).toBe(false);
    expect(isCandidateArticleUrl("https://www.xuexi.cn/xxqg.html?id=a2543113741d4a2285f86f88f0afd87f")).toBe(false);
    expect(isCandidateArticleUrl("https://www.example.com/page.html")).toBe(false);
  });

  test("normalizes urls by retaining article identity params only", () => {
    expect(normalizeArticleUrl("https://www.xuexi.cn/lgpage/detail/index.html?id=123&utm_source=test#foo"))
      .toBe("https://www.xuexi.cn/lgpage/detail/index.html?id=123");
    expect(normalizeArticleUrl("https://article.xuexi.cn/articles/index.html?art_id=123&item_id=456&utm_source=test#foo"))
      .toBe("https://article.xuexi.cn/articles/index.html?art_id=123&item_id=456");
  });
});

describe("looksLikeArticleTitle", () => {
  test("rejects account or navigation text", () => {
    expect(looksLikeArticleTitle("您好，欢迎您【退出】")).toBe(false);
  });

  test("rejects malformed html-like text", () => {
    expect(looksLikeArticleTitle("iv style=\"position: relative; min-height: 0px;\"")).toBe(false);
  });

  test("accepts normal article titles", () => {
    expect(looksLikeArticleTitle("深入学习贯彻党的二十大精神")).toBe(true);
  });
});

describe("extractArticleTitle", () => {
  test("extracts article title from mixed multiline card text", () => {
    const raw = "2026-03-31\n深刻把握树立和践行正确政绩观学习教育总要求\n来源：河北日报";
    expect(extractArticleTitle(raw)).toBe("深刻把握树立和践行正确政绩观学习教育总要求");
  });

  test("skips numeric and date-only lines when extracting title", () => {
    const raw = "001\n2026-03-31\n习近平论中国梦";
    expect(extractArticleTitle(raw)).toBe("习近平论中国梦");
  });

  test("returns empty string when no valid title line exists", () => {
    const raw = "001\n2026-03-31\n";
    expect(extractArticleTitle(raw)).toBe("");
  });

  test("preserves a bullet-prefixed title line for downstream filtering", () => {
    const raw = "2026-03-31\n•系统把握四个“新” 加快发展新质生产力";
    expect(extractArticleTitle(raw)).toBe("•系统把握四个“新” 加快发展新质生产力");
  });
});

describe("normalizeArticleSeriesTitle", () => {
  test("strips serial prefix, year tag, and date from series entry titles", () => {
    expect(normalizeArticleSeriesTitle("VW001.007 习近平论“四个自信” （2026年）2026-02-26"))
      .toBe("习近平论“四个自信”");
    expect(normalizeArticleSeriesTitle("007习近平论“四个自信”"))
      .toBe("习近平论“四个自信”");
  });
});

describe("looksLikeArticleSeriesSectionTitle", () => {
  test("treats 3-digit xi jinping wenhui titles as section entries", () => {
    expect(looksLikeArticleSeriesSectionTitle("004习近平论坚定理想信念")).toBe(true);
  });

  test("does not treat VW article titles as section entries", () => {
    expect(looksLikeArticleSeriesSectionTitle("VW001.004 习近平论坚定理想信念 （2026年）2026-02-24")).toBe(false);
  });
});

describe("isVideoDominatedArticleShape", () => {
  test("rejects video-only article pages", () => {
    expect(isVideoDominatedArticleShape({
      mediaCount: 1,
      longParagraphCount: 0,
      maxContentLength: 120,
      bodyTextLength: 420,
      hasLargeVideoPlayer: true,
    })).toBe(true);
  });

  test("keeps mixed video-plus-text article pages", () => {
    expect(isVideoDominatedArticleShape({
      mediaCount: 1,
      longParagraphCount: 3,
      maxContentLength: 980,
      bodyTextLength: 1800,
      hasLargeVideoPlayer: true,
    })).toBe(false);
  });
});

describe("isSeriesDirectoryShape", () => {
  test("rejects series directory pages disguised as article detail", () => {
    expect(isSeriesDirectoryShape({
      heading: "VW001.001 习近平论坚持和发展中国特色社会主义 （2026年）2026-01-21",
      repeatedSeriesEntryCount: 12,
      matchingSeriesLinkCount: 8,
      longParagraphCount: 0,
      maxContentLength: 980,
      dateLikeCount: 12,
      listItemCount: 18,
    })).toBe(true);
  });

  test("rejects xuexi wenhui directory pages by dense dated list layout", () => {
    expect(isSeriesDirectoryShape({
      heading: "VW001.004 习近平论坚定理想信念 （2026年）2026-02-24",
      repeatedSeriesEntryCount: 3,
      matchingSeriesLinkCount: 2,
      longParagraphCount: 0,
      maxContentLength: 1100,
      dateLikeCount: 10,
      listItemCount: 20,
    })).toBe(true);
  });

  test("keeps real detail pages without repeated dated sibling entries", () => {
    expect(isSeriesDirectoryShape({
      heading: "VW001.001 习近平论坚持和发展中国特色社会主义 （2026年）2026-01-21",
      repeatedSeriesEntryCount: 1,
      matchingSeriesLinkCount: 1,
      longParagraphCount: 4,
      maxContentLength: 2400,
      dateLikeCount: 1,
      listItemCount: 3,
    })).toBe(false);
  });
});
