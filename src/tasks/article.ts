import type { Page } from "puppeteer-core";
import { type HistoryManager } from "../history";
import {
  CHANNEL_KEYWORDS,
  collectArticleCandidates,
  maybeSwitchArticleCategory,
  openArticleFromCandidate,
  openArticleFromSectionPage,
  performArticleReadScroll,
  validateArticlePage,
  type ArticleCardCandidate,
} from "./article_helpers";
import { delay } from "./timing";

async function findChannelUrl(page: Page, keyword: string): Promise<string | null> {
  return await page.evaluate((kw) => {
    const anchors = Array.from(document.querySelectorAll("a"));
    const target = anchors.find((a) => a.textContent?.includes(kw as string));
    return target ? target.href : null;
  }, keyword);
}

async function prepareChannel(page: Page, keyword: string): Promise<string | null> {
  await page.goto("https://www.xuexi.cn/", { waitUntil: "networkidle2" });
  await delay(2000, 4000);

  const channelUrl = await findChannelUrl(page, keyword);
  if (!channelUrl) {
    console.error(`[文章任务] 未能在首页找到进入【${keyword}】的具体入口。退回使用主页全库随机抓取。`);
    return null;
  }

  console.log(`[文章任务] 进入子频道: ${channelUrl}`);
  await page.goto(channelUrl, { waitUntil: "networkidle2" });
  await delay(3000, 5000);
  return channelUrl;
}

async function collectCurrentCandidates(page: Page, completed: number, seenTitles: Set<string>, invalidTitles: Set<string>): Promise<ArticleCardCandidate[]> {
  await page.evaluate(() => window.scrollBy(0, 500));
  await delay(1000, 2000);

  const extraction = await collectArticleCandidates(page, new Set([...seenTitles, ...invalidTitles]));
  if (extraction.results.length > 0 && completed === 0) {
    console.log(`[文章任务] 当前找到 ${extraction.count} 篇候选文章。`);
  }

  return extraction.results;
}

async function recoverToChannelPage(page: Page, articlePage: Page, channelUrl: string | null) {
  if (articlePage !== page) {
    await articlePage.close().catch(() => null);
    await page.bringToFront().catch(() => null);
    return;
  }

  if (channelUrl) {
    await page.goto(channelUrl, { waitUntil: "networkidle2" });
  }
}

async function tryOpenNestedArticle(
  page: Page,
  itemTitle: string,
  seenTitles: Set<string>,
  invalidTitles: Set<string>,
): Promise<{ readingPage: Page; nestedTitle: string | null; count: number } | null> {
  const nestedExtraction = await collectArticleCandidates(
    page,
    new Set([...seenTitles, ...invalidTitles, itemTitle]),
  );
  const nestedCandidates = nestedExtraction.results;

  if (nestedCandidates.length > 0) {
    console.log(`[文章任务] => 已进入文章入口页，找到 ${nestedExtraction.count} 篇候选正文。`);
    const nestedItem = nestedCandidates.slice(0, 6).sort(() => 0.5 - Math.random())[0] ?? nestedCandidates[0];
    if (nestedItem) {
      console.log(`[文章任务] => 入口页内选中文章：${nestedItem.text}`);
      const nestedPage = await openArticleFromCandidate(page, nestedItem, delay);
      if (nestedPage) {
        return { readingPage: nestedPage, nestedTitle: nestedItem.text, count: nestedExtraction.count };
      }
    }
  }

  const nestedPage = await openArticleFromSectionPage(page, itemTitle, delay);
  if (nestedPage) {
    return { readingPage: nestedPage, nestedTitle: null, count: nestedExtraction.count };
  }

  return null;
}

async function processCandidate(
  page: Page,
  channelUrl: string | null,
  item: ArticleCardCandidate,
  history: HistoryManager,
  completed: number,
  targetCount: number,
  seenTitles: Set<string>,
  invalidTitles: Set<string>,
): Promise<boolean> {
  console.log(`[文章任务] (${completed + 1}/${targetCount}) 选中${item.kind === "section" ? "列表" : "文章"}：${item.text || "(无标题)"}`);
  const articlePage = await openArticleFromCandidate(page, item, delay);
  if (!articlePage) {
    console.log("[文章任务] => 点击卡片后未能打开详情页，放弃。");
    invalidTitles.add(item.text);
    return false;
  }

  await delay(4000, 6000);

  let readingPage = articlePage;
  let siteCheck;
  let expectedReadingTitle = item.text;

  if (item.kind === "section") {
    const nestedAttempt = await tryOpenNestedArticle(articlePage, item.text, seenTitles, invalidTitles);
    if (nestedAttempt) {
      readingPage = nestedAttempt.readingPage;
      expectedReadingTitle = nestedAttempt.nestedTitle || item.text;
    }

    if (readingPage === articlePage) {
      console.log("[文章任务] => 已进入子频道列表，但未找到可阅读的正文链接，放弃。");
      invalidTitles.add(item.text);
      await recoverToChannelPage(page, articlePage, channelUrl);
      return false;
    }

    siteCheck = await validateArticlePage(readingPage, expectedReadingTitle);
  } else {
    siteCheck = await validateArticlePage(readingPage, expectedReadingTitle);
    if (!siteCheck.ok && /列表页|目录页|聚合|标题不匹配/.test(siteCheck.reason)) {
      const nestedAttempt = await tryOpenNestedArticle(readingPage, item.text, seenTitles, invalidTitles);
      if (nestedAttempt) {
        readingPage = nestedAttempt.readingPage;
        expectedReadingTitle = nestedAttempt.nestedTitle || item.text;
        siteCheck = await validateArticlePage(readingPage, expectedReadingTitle);
      }
    }
  }

  if (!siteCheck.ok) {
    console.log(`[文章任务] => 判定为无效页面 (${siteCheck.reason})，放弃。`);
    invalidTitles.add(item.text);
    await recoverToChannelPage(page, articlePage, channelUrl);
    return false;
  }

  console.log(`[文章任务] 确认进入正文，标题：${siteCheck.heading || item.text}`);
  console.log("[文章任务] 调整阅读视口...");
  await performArticleReadScroll(readingPage, delay);

  console.log("[文章任务] 等待阅读完成...");
  const waitTime = Math.floor(135000 + Math.random() * 20000);
  await delay(waitTime, waitTime);

  history.addUrl(readingPage.url());
  seenTitles.add(siteCheck.heading || item.text);
  if (item.kind === "section") {
    seenTitles.add(item.text);
  }

  if (readingPage !== page) {
    await readingPage.close().catch(() => null);
    await page.bringToFront().catch(() => null);
  } else if (articlePage !== page && articlePage !== readingPage) {
    await articlePage.close().catch(() => null);
    await page.bringToFront().catch(() => null);
  }

  return true;
}

export async function runArticleTask(page: Page, targetCount: number, history: HistoryManager): Promise<void> {
  if (targetCount <= 0) return;

  console.log(`[文章任务] 开始执行，需要阅读 ${targetCount} 篇文章。`);

  const selectedKeyword = CHANNEL_KEYWORDS[Math.floor(Math.random() * CHANNEL_KEYWORDS.length)] ?? "思想";
  console.log(`[文章任务] 随机选择今日出发频道：${selectedKeyword}`);

  const channelUrl = await prepareChannel(page, selectedKeyword);

  let completed = 0;
  const invalidTitles = new Set<string>();
  const seenTitles = new Set<string>();

  while (completed < targetCount) {
    if (completed === 0 || Math.random() < 0.25) {
      await maybeSwitchArticleCategory(page, delay);
    }

    const candidates = await collectCurrentCandidates(page, completed, seenTitles, invalidTitles);
    if (candidates.length === 0) {
      console.log("[文章任务] 当前视野内未发现符合条件的文章列表，向下探索...");
      const reachedBottom = await page.evaluate(() => (window.innerHeight + window.scrollY) >= document.body.offsetHeight);
      if (reachedBottom) {
        console.log("[文章任务] 已到达页面底部，无法找到更多文章，跳过此频道。");
        break;
      }
      await page.evaluate(() => window.scrollBy(0, 1000));
      await delay(3000, 5000);
      continue;
    }

    let foundNewArticle = false;
    for (const item of candidates.slice(0, 6).sort(() => 0.5 - Math.random())) {
      const success = await processCandidate(page, channelUrl, item, history, completed, targetCount, seenTitles, invalidTitles);
      if (!success) continue;
      completed++;
      foundNewArticle = true;
      break;
    }

    if (!foundNewArticle) {
      console.log("[文章任务] 当前页面的候选文章已尝试完毕，继续查找...");
      await page.evaluate(() => window.scrollBy(0, 1200));
      await delay(3000, 5000);
      continue;
    }

    if (completed < targetCount && channelUrl) {
      await page.goto(channelUrl, { waitUntil: "networkidle2" });
      await page.evaluate(() => window.scrollTo({ top: Math.min(document.body.scrollHeight, window.innerHeight * 0.6), behavior: "smooth" }));
      await delay(3000, 5000);
    }
  }

  console.log(`[文章任务] 执行完毕！阅读了 ${completed} 篇新文章。`);
}

export { isCandidateArticleUrl, looksLikeArticleTitle, normalizeArticleUrl } from "./article_helpers";
