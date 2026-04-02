import type { Page } from "puppeteer-core";

export interface IScore {
  article: { current: number, max: number };
  video: { current: number, max: number };
  quiz: { current: number, max: number };
}

export async function getTargetScores(page: Page): Promise<IScore> {
  await page.goto("https://pc.xuexi.cn/points/my-points.html");
  // 使用新的等待方法代替 waitForTimeout（在新版 puppeteer 中可能被弃用）
  await new Promise(r => setTimeout(r, 3000));
  
  const parseScore = async (title: string) => {
    return await page.evaluate((t) => {
       const titles = Array.from(document.querySelectorAll('.my-points-card-title'));
       const el = titles.find(e => e.textContent?.includes(t));
       if (!el) return { current: 0, max: 0 };
       const scoreEl = el.parentElement?.querySelector('.my-points-card-text');
       if (!scoreEl) return { current: 0, max: 0 };
       const match = scoreEl.textContent?.match(/(\d+)分\/(\d+)分/);
       if (match) return { current: parseInt(match[1]!), max: parseInt(match[2]!) };
       return { current: 0, max: 0 };
    }, title);
  };

  return {
     article: await parseScore("选读文章"), // 兼容 "我要选读文章"
     video: await parseScore("视听学习"),   // 兼容 "我要视听学习"
     quiz: await parseScore("每日答题")
  };
}
