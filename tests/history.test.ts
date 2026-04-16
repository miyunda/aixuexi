import { expect, test, describe, afterAll } from "bun:test";
import { HistoryManager } from "../src/history";
import * as fs from "fs";

describe("HistoryManager", () => {
  const testFile = "test_history.json";
  afterAll(() => { if (fs.existsSync(testFile)) fs.unlinkSync(testFile); });

  test("should add and check URL", () => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    const mgr = new HistoryManager(testFile);
    mgr.addUrl("http://example.com");
    expect(mgr.hasUrl("http://example.com")).toBe(true);
    expect(mgr.hasUrl("http://other.com")).toBe(false);
  });

  test("should normalize hash and tracking query", () => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    const mgr = new HistoryManager(testFile);
    mgr.addUrl("https://www.xuexi.cn/lgpage/detail/index.html?id=123&utm_source=test#section");
    expect(mgr.hasUrl("https://www.xuexi.cn/lgpage/detail/index.html?id=123")).toBe(true);
    expect(mgr.hasUrl("https://www.xuexi.cn/lgpage/detail/index.html?id=456")).toBe(false);
  });

  test("should preserve article identity params", () => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    const mgr = new HistoryManager(testFile);
    mgr.addUrl("https://article.xuexi.cn/articles/index.html?art_id=123&item_id=456&utm_source=test");
    expect(mgr.hasUrl("https://article.xuexi.cn/articles/index.html?art_id=123&item_id=456")).toBe(true);
    expect(mgr.hasUrl("https://article.xuexi.cn/articles/index.html?art_id=123&item_id=999")).toBe(false);
  });

  test("should add and check article titles with whitespace normalization", () => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    const mgr = new HistoryManager(testFile);
    mgr.addArticleTitle("《求是》杂志发表习近平总书记重要文章");
    expect(mgr.hasArticleTitle("《求是》 杂志发表习近平总书记重要文章")).toBe(true);
    expect(mgr.hasArticleTitle("推动全民阅读，建设书香社会")).toBe(false);
  });
});
