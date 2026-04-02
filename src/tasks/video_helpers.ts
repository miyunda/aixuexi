import type { Page } from "puppeteer-core";

export const VIDEO_PAGE_URL = "https://www.xuexi.cn/0809b8b6ab8a81a4f55ce9cbefa16eff/ae60b027cb83715fd0eeb7bb2527e88b.html";
export const LGDATA_KEYS = [
  "3nm8if67c913",
  "48cdilh72vp4",
  "3m1erqf28h0r",
  "41gt3rsjd6l8",
  "543sq8rd54eo",
];

export function extractVideoLinksFromHtml(html: string): string[] {
  const matches = html.matchAll(/https:\/\/www\.xuexi\.cn\/lgpage\/detail\/index\.html\?id=(\d+)/g);
  const urls = new Set<string>();
  for (const match of matches) {
    urls.add(`https://www.xuexi.cn/lgpage/detail/index.html?id=${match[1]}`);
  }
  return Array.from(urls);
}

export async function fetchVideoLinksFromPage(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const html = document.body.innerHTML;
    const matches = html.matchAll(/https:\/\/www\.xuexi\.cn\/lgpage\/detail\/index\.html\?id=(\d+)/g);
    const urls = new Set<string>();
    for (const match of matches) {
      urls.add(`https://www.xuexi.cn/lgpage/detail/index.html?id=${match[1]}`);
    }
    return Array.from(urls);
  });
}

export async function getLgdataVideoLinks(page: Page, lgdataKey: string, refererUrl: string): Promise<string[]> {
  return await page.evaluate(async (key: string, referer: string) => {
    try {
      const url = `https://www.xuexi.cn/lgdata/${key}.json?_st=1`;
      const res = await fetch(url, {
        credentials: "include",
        headers: {
          Referer: referer,
          Origin: "https://www.xuexi.cn",
        },
      });
      if (!res.ok) return [];
      const data = await res.json() as Array<{ url?: string }>;
      return data
        .filter((item) => item.url && item.url.includes("lgpage/detail"))
        .map((item) => item.url as string);
    } catch {
      return [];
    }
  }, lgdataKey, refererUrl);
}

export async function collectVideoLinks(page: Page, delay: (min: number, max: number) => Promise<void>): Promise<string[]> {
  console.log("[视频任务] 前往学习电视台，收集视频数据...");
  await page.goto(VIDEO_PAGE_URL, { waitUntil: "networkidle2" });
  await delay(4000, 6000);

  const domLinks = await fetchVideoLinksFromPage(page);
  console.log(`[视频任务] 从 DOM 中提取到 ${domLinks.length} 个视频链接`);

  let apiLinks: string[] = [];
  for (const key of LGDATA_KEYS) {
    const links = await getLgdataVideoLinks(page, key, VIDEO_PAGE_URL);
    if (links.length > 0) {
      console.log(`[视频任务] 从 lgdata/${key} 获取到 ${links.length} 个视频`);
      apiLinks = apiLinks.concat(links);
    }
    await delay(500, 1200);
  }

  return [...new Set([...domLinks, ...apiLinks])];
}

export async function isVideoPage(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    if (document.querySelector("video")) return true;
    if (document.querySelector(".prism-player")) return true;
    if (document.querySelector(".video-wrap")) return true;
    if (document.querySelector(".study-material-video")) return true;
    return false;
  });
}

export async function positionVideoPlayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const player = document.querySelector(".prism-player") || document.querySelector("video");
    if (player) {
      player.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

export async function startVideoPlayback(page: Page): Promise<string> {
  return await page.evaluate(async () => {
    const video = document.querySelector("video");
    if (!video) return "no_video_element";

    const playBtn = document.querySelector(".prism-play-btn") as HTMLElement
      || document.querySelector(".prism-big-play-btn") as HTMLElement
      || document.querySelector(".xuexi-play-btn") as HTMLElement;

    if (playBtn) {
      playBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!video.paused) return "clicked_btn_success";
    }

    try {
      video.muted = true;
      await video.play();
      return "js_play_success";
    } catch (err) {
      return `failed: ${String(err)}`;
    }
  });
}
