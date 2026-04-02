import type { Page } from "puppeteer-core";
import { type HistoryManager } from "../history";
import {
  VIDEO_PAGE_URL,
  collectVideoLinks,
  isVideoPage,
  positionVideoPlayer,
  startVideoPlayback,
} from "./video_helpers";
import { delay } from "./timing";

async function collectCandidateVideos(page: Page, history: HistoryManager): Promise<string[]> {
  const allLinks = await collectVideoLinks(page, delay);
  const candidates = allLinks
    .filter((link) => !history.hasUrl(link))
    .sort(() => 0.5 - Math.random());

  console.log(`[视频任务] 共找到 ${candidates.length} 个候选视频（排除历史后）`);
  return candidates;
}

async function watchVideo(page: Page, link: string, completed: number, targetCount: number, history: HistoryManager): Promise<boolean> {
  console.log(`[视频任务] (${completed + 1}/${targetCount}) 前往视频详情页：${link}`);
  await page.goto(link, { waitUntil: "networkidle2", referer: VIDEO_PAGE_URL });
  await delay(3000, 5000);

  const playable = await isVideoPage(page);
  if (!playable) {
    console.log("[视频任务] => 未检测到视频播放器，跳过。");
    return false;
  }

  await positionVideoPlayer(page);
  await delay(2000, 3000);

  const playResult = await startVideoPlayback(page);
  console.log(`[视频任务] 起播尝试结果: ${playResult}`);

  if (playResult.includes("success")) {
    console.log("[视频任务] 视频已激活并开始播放，等待观看完成...");
  } else {
    console.log("[视频任务] 未能确认视频起播状态，继续等待页面播放反馈...");
  }

  const waitTime = Math.floor(130000 + Math.random() * 50000);
  await delay(waitTime, waitTime);

  history.addUrl(link);
  return true;
}

export async function runVideoTask(page: Page, targetCount: number, history: HistoryManager): Promise<void> {
  if (targetCount <= 0) return;

  console.log(`[视频任务] 开始执行，需要观看 ${targetCount} 个视频。`);
  const candidates = await collectCandidateVideos(page, history);

  if (candidates.length === 0) {
    console.log("[视频任务] 没有找到可用的新视频链接！");
    return;
  }

  let completed = 0;
  for (const link of candidates) {
    if (completed >= targetCount) break;
    const success = await watchVideo(page, link, completed, targetCount, history);
    if (success) completed++;
  }

  console.log(`[视频任务] 执行完毕！观看了 ${completed} 个新视频。`);
}
