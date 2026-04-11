import type { ElementHandle, Page } from "puppeteer-core";

export const CHANNEL_KEYWORDS = ["思想", "二十大时间", "习近平文汇", "学习理论", "红色中国", "学习科学", "强军兴军"];
export const CATEGORY_BLACKLIST = ["首页", "学习电视台", "实地调研", "学习积分", "强国商城", "五个一工程", "积分", "商城", "听书", "广播", "电台", "音频", "音乐", "理论视听"];
export const ARTICLE_CARD_SELECTORS = [
  "div.text-link-item-title",
  ".item-inner .textWrapper",
  ".grid-cell .text",
  ".text-link-item",
  ".list .item",
  ".grid-cell",
];
export const ARTICLE_TEXT_BLACKLIST = [
  "退出",
  "登录",
  "您好",
  "欢迎您",
  "我的积分",
  "搜索",
  "请输入关键字",
  "版权所有",
  "友情链接",
  "隐私",
  "法律声明",
  "关于我们",
  "用户反馈",
  "app下载",
];

export type ArticleCardCandidate = {
  text: string;
  selector: string;
  index: number;
  source: string;
  kind: "article" | "section";
};

export type ArticleSiteCheckResult =
  | { ok: true; heading: string }
  | { ok: false; reason: string };

export function isVideoDominatedArticleShape(input: {
  mediaCount: number;
  longParagraphCount: number;
  maxContentLength: number;
  bodyTextLength: number;
  hasLargeVideoPlayer: boolean;
}): boolean {
  return (
    input.mediaCount >= 1 &&
    input.hasLargeVideoPlayer &&
    input.longParagraphCount === 0 &&
    input.maxContentLength < 260 &&
    input.bodyTextLength < 900
  );
}

export function isLikelyArticleListShape(input: {
  textLinkItemTitleCount: number;
  dateLikeCount: number;
  anchorCount: number;
  meaningfulParagraphCount: number;
  maxContentLength: number;
  hasBylineMeta: boolean;
}): boolean {
  return (
    input.textLinkItemTitleCount >= 8 &&
    input.dateLikeCount >= 6 &&
    input.anchorCount >= 20 &&
    input.meaningfulParagraphCount < 2 &&
    input.maxContentLength < 900 &&
    !input.hasBylineMeta
  );
}

export function normalizeArticleSeriesTitle(rawText: string): string {
  return rawText
    .replace(/^VW\d+\.\d+\s*/i, "")
    .replace(/^\d{3}\s*/i, "")
    .replace(/（\d{4}年.*?）/g, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\s+/g, "")
    .trim();
}

export function looksLikeArticleSeriesSectionTitle(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return /^\d{3}习近平论/.test(compact);
}

export function isSeriesDirectoryShape(input: {
  heading: string;
  repeatedSeriesEntryCount: number;
  matchingSeriesLinkCount: number;
  matchingSeriesAlternateLinkCount?: number;
  longParagraphCount: number;
  maxContentLength: number;
  dateLikeCount?: number;
  listItemCount?: number;
}): boolean {
  const compactHeading = input.heading.replace(/\s+/g, "");
  const headingLooksLikeSeriesEntry = /^VW\d+\.\d+/i.test(compactHeading);
  return (
    headingLooksLikeSeriesEntry &&
    input.longParagraphCount < 2 &&
    input.maxContentLength < 1400 &&
    (
      input.repeatedSeriesEntryCount >= 6 ||
      input.matchingSeriesLinkCount >= 4 ||
      ((input.matchingSeriesAlternateLinkCount || 0) >= 1 && input.longParagraphCount < 3) ||
      ((input.dateLikeCount || 0) >= 4 && (input.listItemCount || 0) >= 8)
    )
  );
}

export function normalizeArticleUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";

    const keepParams = ["id", "art_id", "item_id"];
    const filtered = new URLSearchParams();
    for (const key of keepParams) {
      const value = url.searchParams.get(key);
      if (value) filtered.set(key, value);
    }
    url.search = filtered.toString() ? `?${filtered.toString()}` : "";
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

export function isCandidateArticleUrl(rawUrl: string, currentUrl = ""): boolean {
  try {
    const url = new URL(rawUrl);
    const normalized = normalizeArticleUrl(url.toString());
    const normalizedCurrent = currentUrl ? normalizeArticleUrl(currentUrl) : "";

    if (!url.hostname.endsWith("xuexi.cn")) return false;
    if (normalizedCurrent && normalized === normalizedCurrent) return false;

    const pathname = url.pathname.toLowerCase();
    if (pathname === "/") return false;
    if (pathname.endsWith("/index.html") && !pathname.includes("/detail/") && url.hostname !== "article.xuexi.cn") return false;
    if (pathname.endsWith("/xxqg.html")) return false;

    const combined = `${pathname}${url.search}`.toLowerCase();
    const legalKeywords = ["privacy", "statement", "about", "copyright", "law"];
    if (legalKeywords.some((keyword) => combined.includes(keyword))) return false;

    return (
      url.hostname === "article.xuexi.cn" ||
      pathname.includes("/html/") ||
      pathname.endsWith(".html") ||
      pathname.includes("/detail/")
    );
  } catch {
    return false;
  }
}

export function looksLikeArticleTitle(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  const compact = normalized.replace(/\s+/g, "");
  if (normalized.length < 6 || normalized.length > 60) return false;
  if (/<|>|{|}|function|\bvar\b|const|class=|style=|div /.test(normalized)) return false;
  if (/!important|overflow:|display:|position:|padding:|margin:|font-|line-height:|color:|background:/.test(normalized)) return false;
  if (/[.#][\w-]+(?::[\w-]+)?\s*\{/.test(normalized)) return false;
  if (ARTICLE_TEXT_BLACKLIST.some((keyword) => compact.includes(keyword.replace(/\s+/g, "")))) return false;
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(compact)) return false;
  if (/退出|登录|欢迎您|搜索结果|积分明细/.test(compact)) return false;
  return true;
}

export function extractArticleTitle(rawText: string): string {
  const lines = rawText
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^\d{4}-\d{2}-\d{2}.*$/.test(line) && line.length <= 19) continue;
    if (/^\d+$/.test(line)) continue;
    return line;
  }

  return "";
}

export async function maybeSwitchArticleCategory(page: Page, delay: (min: number, max: number) => Promise<void>): Promise<void> {
  const category = await page.evaluate((blacklist) => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".gv-top-banner .nav-item"));
    const candidates = items
      .map((item) => ({ element: item, text: (item.textContent || "").replace(/\s+/g, " ").trim() }))
      .filter(({ text }) => text && text.length > 1 && text.length < 10 && !blacklist.some((word) => text.includes(word)));

    if (candidates.length === 0) return null;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    if (!target) return null;
    target.element.scrollIntoView({ behavior: "smooth", block: "center" });
    target.element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return target.text;
  }, CATEGORY_BLACKLIST);

  if (category) {
    console.log(`[文章任务] 切换子分类: ${category}`);
    await delay(2500, 4000);
  }
}

export async function collectArticleCandidates(page: Page, seenTitles: Set<string>): Promise<{
  results: ArticleCardCandidate[];
  count: number;
}> {
  const seen = new Set<string>();
  const results: ArticleCardCandidate[] = [];

  for (const selector of ARTICLE_CARD_SELECTORS) {
    const handles = await page.$$(selector);

    for (let index = 0; index < handles.length; index++) {
      const handle = handles[index];
      if (!handle) continue;

      const rawText = await handle.evaluate((node) => (node.textContent || "").replace(/\s+/g, " ").trim());
      const title = extractArticleTitle(rawText);
      if (!looksLikeArticleTitle(title)) continue;
      if (CATEGORY_BLACKLIST.some((word) => title.includes(word))) continue;
      if (seenTitles.has(title) || seen.has(title)) continue;

      const isSectionLike = await handle.evaluate((node, candidateTitle) => {
        const el = node as HTMLElement;
        const text = (candidateTitle || "").replace(/\s+/g, " ").trim();
        const compact = text.replace(/\s+/g, "");
        const container = el.closest(".module, .list, .item-inner, .text-link-item, .grid-cell, [class*='module'], [class*='list'], [class*='section']") || el.parentElement;
        const containerText = (container?.textContent || "").replace(/\s+/g, " ");
        const dateMatches = containerText.match(/\d{4}-\d{2}-\d{2}/g) || [];
        const linkCount = container?.querySelectorAll("a").length || 0;
        const itemCount = container?.querySelectorAll("li, .item, .text-link-item, .grid-cell, [class*='item']").length || 0;
        const headerish = /^•/.test(compact) ? false : !/[，。；：？！]/.test(text) && compact.length <= 20;
        const hasManySiblingEntries = dateMatches.length >= 4 || linkCount >= 6 || itemCount >= 6;
        return headerish && hasManySiblingEntries;
      }, title);
      if (isSectionLike) continue;

      const kind: "article" | "section" = looksLikeArticleSeriesSectionTitle(title) ? "section" : "article";

      seen.add(title);
      results.push({
        text: title,
        selector,
        index,
        source: "card",
        kind,
      });
    }
  }

  return { results, count: results.length };
}

async function getHandleForCandidate(page: Page, candidate: ArticleCardCandidate): Promise<ElementHandle<Element> | null> {
  const handles = await page.$$(candidate.selector);
  return handles[candidate.index] || null;
}

export async function openArticleFromCandidate(
  page: Page,
  candidate: ArticleCardCandidate,
  delay: (min: number, max: number) => Promise<void>,
): Promise<Page | null> {
  const handle = await getHandleForCandidate(page, candidate);
  if (!handle) return null;

  const browser = page.browser();
  const originalUrl = page.url();
  const originalPages = await browser.pages();
  const existingTargets = new Set(originalPages.map((p) => p.target()));

  await handle.evaluate((node) => node.scrollIntoView({ behavior: "smooth", block: "center" }));
  await delay(1200, 2200);

  const navigationPromise = page.waitForNavigation({ waitUntil: "networkidle2", timeout: 12000 }).then(() => "same").catch(() => null);
  await handle.click({ delay: Math.floor(80 + Math.random() * 120) }).catch(async () => {
    await handle.evaluate((node) => {
      (node as HTMLElement).click();
    });
  });

  const navResult = await navigationPromise;
  if (navResult === "same" && page.url() !== originalUrl) {
    return page;
  }

  await delay(1500, 3000);
  const currentPages = await browser.pages();
  const popupPage = currentPages.find((p) => !existingTargets.has(p.target()));
  if (popupPage) {
    try {
      await popupPage.bringToFront();
      await popupPage.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 }).catch(() => null);
    } catch {
      // Ignore popup stabilization errors and let later checks decide.
    }
    return popupPage;
  }

  const fallbackHref = await handle.evaluate((node) => {
    const el = node as HTMLElement;
    return el.closest("a[href]")?.getAttribute("href")
      || el.getAttribute("data-href")
      || el.getAttribute("data-url")
      || el.parentElement?.getAttribute("data-href")
      || el.parentElement?.getAttribute("data-url")
      || null;
  });

  if (fallbackHref && isCandidateArticleUrl(fallbackHref, originalUrl)) {
    await page.goto(fallbackHref, { waitUntil: "networkidle2", referer: originalUrl });
    return page;
  }

  return null;
}

export async function openArticleFromSectionPage(
  page: Page,
  expectedTitle: string,
  delay: (min: number, max: number) => Promise<void>,
): Promise<Page | null> {
  const originalUrl = page.url();
  const nestedHref = await page.evaluate((rawExpectedTitle) => {
    const currentUrl = location.href;
    const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, "").trim();
    const normalizeSeriesTitle = (value: string | null | undefined) => normalize(value)
      .replace(/^VW\d+\.\d+/i, "")
      .replace(/^\d{3}/, "")
      .replace(/（\d{4}年.*?）/g, "")
      .replace(/\d{4}-\d{2}-\d{2}/g, "");
    const expected = normalizeSeriesTitle(rawExpectedTitle);
    if (!expected) return "";

    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const candidates = anchors
      .map((anchor) => {
        const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
        const compact = normalize(text);
        const normalizedTitle = normalizeSeriesTitle(text);
        const rect = anchor.getBoundingClientRect();
        const rowText = normalize(anchor.parentElement?.textContent || anchor.closest("li, tr, .item, .text-link-item, .grid-cell")?.textContent || "");
        const hasDate = /\d{4}-\d{2}-\d{2}/.test(rowText);
        const hasYearTag = /（\d{4}年/.test(text) || /（\d{4}年/.test(anchor.parentElement?.textContent || "");
        const inLeftColumn = rect.left < window.innerWidth * 0.7;
        const exactSeriesEntry = /^VW\d+\.\d+/i.test(compact);
        let score = 0;
        if (exactSeriesEntry) score += 8;
        if (hasDate) score += 4;
        if (hasYearTag) score += 3;
        if (normalizedTitle === expected) score += 4;
        else if (normalizedTitle.startsWith(expected) || expected.startsWith(normalizedTitle)) score += 2;
        try {
          const hrefUrl = new URL(anchor.href, currentUrl);
          const pathname = hrefUrl.pathname.toLowerCase();
          if (hrefUrl.hostname === "article.xuexi.cn") score += 10;
          if (pathname.includes("/detail/")) score += 8;
          if (pathname.includes("lgpage/detail")) score += 8;
          if (/\/articles\/.*\.html$/.test(pathname)) score += 6;
          if (pathname.endsWith(".html")) score += 1;
          if (hrefUrl.toString() === currentUrl) score -= 20;
        } catch {
          score -= 10;
        }
        return {
          href: anchor.href,
          compact,
          normalizedTitle,
          hasDate,
          hasYearTag,
          inLeftColumn,
          top: rect.top,
          score,
        };
      })
      .filter((item) => {
        if (!item.href) return false;
        if (!item.inLeftColumn) return false;
        if (!item.normalizedTitle || !item.normalizedTitle.includes(expected)) return false;
        return item.hasDate || item.hasYearTag;
      })
      .sort((a, b) => (b.score - a.score) || (a.top - b.top));

    return candidates[0]?.href || "";
  }, expectedTitle);

  if (!nestedHref || !isCandidateArticleUrl(nestedHref, originalUrl)) {
    return null;
  }

  await page.goto(nestedHref, { waitUntil: "networkidle2", referer: originalUrl });
  await delay(2000, 3500);
  return page;
}

export async function validateArticlePage(page: Page, expectedTitle: string): Promise<ArticleSiteCheckResult> {
  return await page.evaluate((articleTextBlacklist, rawExpectedTitle) => {
    const sanitizeTitle = (text: string | null | undefined) => (text || "")
      .replace(/\s+/g, " ")
      .replace(/\s*[|｜-]\s*学习强国.*$/, "")
      .trim();
    const isCssLikeText = (text: string) => /[{}]/.test(text) && /!important|overflow:|display:|position:|padding:|margin:|font-|line-height:|color:|background:/.test(text);
    const isLikelyListPage = (input: {
      textLinkItemTitleCount: number;
      dateLikeCount: number;
      anchorCount: number;
      meaningfulParagraphCount: number;
      maxContentLength: number;
      hasBylineMeta: boolean;
    }) => (
      input.textLinkItemTitleCount >= 8 &&
      input.dateLikeCount >= 6 &&
      input.anchorCount >= 20 &&
      input.meaningfulParagraphCount < 2 &&
      input.maxContentLength < 900 &&
      !input.hasBylineMeta
    );
    const looksLikeTitle = (text: string) => {
      const normalized = sanitizeTitle(text);
      const compact = normalized.replace(/\s+/g, "");
      if (normalized.length < 6 || normalized.length > 60) return false;
      if (/<|>|{|}|function|\bvar\b|const|class=|style=|div /.test(normalized)) return false;
      if (/!important|overflow:|display:|position:|padding:|margin:|font-|line-height:|color:|background:/.test(normalized)) return false;
      if (/[.#][\w-]+(?::[\w-]+)?\s*\{/.test(normalized)) return false;
      if (articleTextBlacklist.some((keyword) => compact.includes(keyword.replace(/\s+/g, "")))) return false;
      if (!/[\u4e00-\u9fa5A-Za-z]/.test(compact)) return false;
      if (/退出|登录|欢迎您|搜索结果|积分明细/.test(compact)) return false;
      return true;
    };

    const normalizeSeriesTitle = (value: string | null | undefined) => (value || "")
      .replace(/\s+/g, "")
      .replace(/^VW\d+\.\d+\s*/i, "")
      .replace(/^\d{3}\s*/i, "")
      .replace(/（\d{4}年.*?）/g, "")
      .replace(/\d{4}-\d{2}-\d{2}/g, "")
      .trim();
    const isSeriesDirectory = (input: {
      heading: string;
      repeatedSeriesEntryCount: number;
      matchingSeriesLinkCount: number;
      matchingSeriesAlternateLinkCount: number;
      longParagraphCount: number;
      maxContentLength: number;
      dateLikeCount: number;
      listItemCount: number;
    }) => {
      const compactHeading = input.heading.replace(/\s+/g, "");
      const headingLooksLikeSeriesEntry = /^VW\d+\.\d+/i.test(compactHeading);
      return (
        headingLooksLikeSeriesEntry &&
        input.longParagraphCount < 2 &&
        input.maxContentLength < 1400 &&
        (
          input.repeatedSeriesEntryCount >= 6 ||
          input.matchingSeriesLinkCount >= 4 ||
          (input.matchingSeriesAlternateLinkCount >= 1 && input.longParagraphCount < 3) ||
          (input.dateLikeCount >= 4 && input.listItemCount >= 8)
        )
      );
    };

    const currentUrl = location.href.toLowerCase();
    const title = document.title;
    const titleBlacklist = ["版权", "隐私", "声明", "法律", "政策", "搜索", "登录", "积分", "用户", "账号"];
    if (titleBlacklist.some((item) => title.includes(item))) return { ok: false, reason: "标题包含拦截词" } as const;
    const urlBlacklist = ["/search.html", "keyword=", "/user/", "/login", "points", "score"];
    if (urlBlacklist.some((keyword) => currentUrl.includes(keyword))) return { ok: false, reason: "URL 指向搜索/账户页面" } as const;

    const selectors = ["article", "main", ".rich-text", ".render-detail-article", ".detail-content", ".text-content", "[class*='article']", "[class*='detail']", "[class*='content']", "[id*='article']", "[id*='content']"];
    const contentLengths = selectors
      .flatMap((sel) => Array.from(document.querySelectorAll(sel)))
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 0 && !isCssLikeText(text))
      .map((text) => text.length);
    const maxContentLength = contentLengths.length > 0 ? Math.max(...contentLengths) : 0;
    const longP = Array.from(document.querySelectorAll("p")).filter((p) => {
      const text = (p.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length <= 50) return false;
      const pathText = `${p.className || ""} ${p.parentElement?.className || ""} ${p.parentElement?.id || ""} ${p.closest("footer, nav, header, aside")?.className || ""}`.toLowerCase();
      if (/copyright|footer|bottom|aside|sidebar|nav|header|menu|tool|recommend|related/.test(pathText)) return false;
      if (articleTextBlacklist.some((keyword) => text.includes(keyword))) return false;
      if (/版权所有|许可证|举报电话|ICP备案|京公网安备|Copyright/i.test(text)) return false;
      if (p.querySelectorAll("a").length >= 2) return false;
      return /[，。；：？！]/.test(text);
    });
    const bodyTextLength = (document.body.innerText || "").replace(/\s+/g, " ").trim().length;
    const mediaCount = document.querySelectorAll("video, audio, iframe").length;
    const hasLargeVideoPlayer = Array.from(document.querySelectorAll<HTMLElement>("video, iframe, .prism-player, [class*='player'], [class*='video']")).some((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width >= 320 && rect.height >= 180;
    });
    const expectedNormalized = sanitizeTitle((rawExpectedTitle || "").replace(/^•+/, "").replace(/\s+/g, " ").trim());
    const headingCandidates = Array.from(document.querySelectorAll("h1, h2, .title, [class*='title'], [class*='header'], [class*='headline']"))
      .map((el) => sanitizeTitle(el.textContent || ""))
      .filter(Boolean);
    const titleFromDocumentTitle = sanitizeTitle(document.title);
    const bodyLines = (document.body.innerText || "")
      .split("\n")
      .map((line) => sanitizeTitle(line))
      .filter(Boolean);
    const bodyHeadingCandidate = bodyLines.find((line, index) => {
      if (index > 18) return false;
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(line) || /^来源[:：]?$/.test(line) || /^打印$/.test(line)) return false;
      return looksLikeTitle(line);
    }) || "";
    const heading = [
      headingCandidates.find((text) => looksLikeTitle(text)) || "",
      looksLikeTitle(titleFromDocumentTitle) ? titleFromDocumentTitle : "",
      bodyHeadingCandidate,
      looksLikeTitle(expectedNormalized) ? expectedNormalized : "",
    ].find(Boolean) || "";
    const articleMeta = (document.body.innerText || "").slice(0, 1600);
    const hasDateMeta = /\d{4}-\d{1,2}-\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日/.test(articleMeta);
    const hasBylineMeta = /来源|责任编辑|作者|播报员/.test(articleMeta);
    const hasPublishMeta = hasDateMeta || hasBylineMeta;
    const dateLikeCount = (document.body.innerText.match(/\d{4}-\d{2}-\d{2}/g) || []).length;
    const anchorCount = document.querySelectorAll("a").length;
    const listItemCount = document.querySelectorAll("li, .item, .text-link-item, .grid-cell, [class*='item']").length;
    const textLinkItemTitleCount = document.querySelectorAll(".text-link-item-title").length;
    const repeatedSeriesEntryCount = Array.from(document.querySelectorAll("a[href], li, tr"))
      .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
      .filter((text) => /^VW\d+\.\d+/.test(text) || /\d{4}-\d{2}-\d{2}/.test(text))
      .length;
    const normalizedHeadingSeries = normalizeSeriesTitle(heading);
    const matchingSeriesLinkCount = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((anchor) => {
        const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
        const normalizedTitle = normalizeSeriesTitle(text);
        const rowText = (anchor.parentElement?.textContent || anchor.closest("li, tr, .item, .text-link-item, .grid-cell")?.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        const rect = anchor.getBoundingClientRect();
        const inLeftColumn = rect.left < window.innerWidth * 0.7;
        return {
          normalizedTitle,
          inLeftColumn,
          hasDate: /\d{4}-\d{2}-\d{2}/.test(rowText),
          hasYearTag: /（\d{4}年/.test(text) || /（\d{4}年/.test(rowText),
        };
      })
      .filter((item) => {
        if (!normalizedHeadingSeries || !item.normalizedTitle) return false;
        if (!item.inLeftColumn) return false;
        if (!item.normalizedTitle.includes(normalizedHeadingSeries)) return false;
        return item.hasDate || item.hasYearTag;
      })
      .length;
    const matchingSeriesAlternateLinkCount = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((anchor) => {
        const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
        const normalizedTitle = normalizeSeriesTitle(text);
        const rowText = (anchor.parentElement?.textContent || anchor.closest("li, tr, .item, .text-link-item, .grid-cell")?.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        const rect = anchor.getBoundingClientRect();
        const inLeftColumn = rect.left < window.innerWidth * 0.7;
        const href = anchor.href || "";
        return {
          href,
          normalizedTitle,
          inLeftColumn,
          hasDate: /\d{4}-\d{2}-\d{2}/.test(rowText),
          hasYearTag: /（\d{4}年/.test(text) || /（\d{4}年/.test(rowText),
        };
      })
      .filter((item) => {
        if (!normalizedHeadingSeries || !item.normalizedTitle) return false;
        if (!item.inLeftColumn) return false;
        if (!item.href || item.href === location.href) return false;
        if (item.normalizedTitle !== normalizedHeadingSeries) return false;
        return item.hasDate || item.hasYearTag;
      })
      .length;
    const searchInput = document.querySelector("input[type='search'], input[placeholder*='搜索'], input[placeholder*='关键字']");
    const hasSearchResultsHeading = /搜索结果|共找到|条结果/.test(articleMeta);

    if (!heading || !looksLikeTitle(heading)) return { ok: false, reason: "缺少可信文章标题" } as const;
    if (expectedNormalized) {
      const normalizedHeading = heading.replace(/^•+/, "").replace(/\s+/g, " ").trim();
      const titleMatches = normalizedHeading.includes(expectedNormalized) || expectedNormalized.includes(normalizedHeading);
      if (!titleMatches && longP.length < 2 && maxContentLength < 900) {
        return { ok: false, reason: "页面标题与候选标题不匹配" } as const;
      }
    }
    if (isLikelyListPage({
      textLinkItemTitleCount,
      dateLikeCount,
      anchorCount,
      meaningfulParagraphCount: longP.length,
      maxContentLength,
      hasBylineMeta,
    })) {
      return { ok: false, reason: "页面更像文章列表页" } as const;
    }
    if ((searchInput || hasSearchResultsHeading) && maxContentLength < 600 && longP.length < 2) {
      return { ok: false, reason: "页面更像搜索结果页" } as const;
    }
    if (textLinkItemTitleCount >= 8 && longP.length < 2 && !hasPublishMeta) {
      return { ok: false, reason: "页面更像文本列表页" } as const;
    }
    if (dateLikeCount >= 6 && anchorCount >= 20 && longP.length < 2 && maxContentLength < 800) {
      return { ok: false, reason: "页面更像文章列表页" } as const;
    }
    if (repeatedSeriesEntryCount >= 6 && longP.length < 2 && maxContentLength < 900) {
      return { ok: false, reason: "页面更像专题目录页" } as const;
    }
    if (isSeriesDirectory({
      heading,
      repeatedSeriesEntryCount,
      matchingSeriesLinkCount,
      matchingSeriesAlternateLinkCount,
      longParagraphCount: longP.length,
      maxContentLength,
      dateLikeCount,
      listItemCount,
    })) {
      return { ok: false, reason: "页面更像系列目录页" } as const;
    }
    if (listItemCount >= 12 && longP.length < 2 && maxContentLength < 800) {
      return { ok: false, reason: "页面以列表聚合为主" } as const;
    }
    if (maxContentLength < 350 && longP.length < 2 && bodyTextLength < 800) {
      return { ok: false, reason: "正文文本量不足" } as const;
    }
    if (
      mediaCount >= 1 &&
      hasLargeVideoPlayer &&
      longP.length === 0 &&
      maxContentLength < 260 &&
      bodyTextLength < 900
    ) {
      return { ok: false, reason: "页面以视频播放为主" } as const;
    }
    if (mediaCount > 2 && maxContentLength < 500 && longP.length < 2) {
      return { ok: false, reason: "页面以媒体内容为主" } as const;
    }
    if (!hasPublishMeta && longP.length < 3 && maxContentLength < 600) {
      return { ok: false, reason: "缺少文章元信息" } as const;
    }

    return { ok: true, heading } as const;
  }, ARTICLE_TEXT_BLACKLIST, expectedTitle);
}

export async function performArticleReadScroll(page: Page, delay: (min: number, max: number) => Promise<void>): Promise<void> {
  await page.evaluate(() => {
    const contentRoot =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector(".rich-text") ||
      document.querySelector(".render-detail-article") ||
      document.querySelector(".detail-content") ||
      document.querySelector(".text-content") ||
      document.querySelector("[class*='article']") ||
      document.querySelector("[class*='content']");

    if (!contentRoot) {
      window.scrollTo({ top: Math.max(0, window.innerHeight * 0.5), behavior: "smooth" });
      return;
    }

    const paragraphs = Array.from(contentRoot.querySelectorAll("p"))
      .filter((node) => (node.textContent || "").replace(/\s+/g, " ").trim().length > 40);
    const anchorNode = paragraphs[Math.min(1, paragraphs.length - 1)] || contentRoot;
    const rect = anchorNode.getBoundingClientRect();
    const absoluteTop = rect.top + window.scrollY;
    const targetTop = Math.max(0, absoluteTop - window.innerHeight * 0.35);
    window.scrollTo({ top: targetTop, behavior: "smooth" });
  });

  await delay(1800, 2400);

  for (const step of [220, 180, 240]) {
    await page.evaluate((distance) => {
      window.scrollBy({ top: distance, behavior: "smooth" });
    }, step);
    await delay(1800, 2400);
  }
}
