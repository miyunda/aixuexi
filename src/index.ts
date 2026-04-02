import { loadConfig } from "./config";
import { BrowserEngine } from "./browser";
import { HistoryManager } from "./history";
import { RunLogger } from "./logger";
import { checkAndLogin } from "./tasks/auth";
import { getTargetScores } from "./tasks/score";
import { handleManualQuiz } from "./tasks/quiz";
import { runArticleTask } from "./tasks/article";
import { runVideoTask } from "./tasks/video";

async function main() {
  const config = loadConfig();
  const logger = new RunLogger({ retentionDays: config.logRetentionDays ?? 365 });
  logger.start();
  console.log("====== 爱学习 App 启动 ======");
  const history = new HistoryManager("./data/history.json");
  const engine = new BrowserEngine();
  
  await engine.init(config);
  const page = engine.page!;
  
  try {
     await checkAndLogin(page);
     let scores = await getTargetScores(page);
     console.log("初始得分情况：", JSON.stringify(scores, null, 2));
     
     // 每日答题拦截处理
     await handleManualQuiz(page, scores.quiz.current, scores.quiz.max, config.quiz);

     if (config.quiz?.only) {
       console.log("已启用 `quiz.only=true`，本轮仅执行每日答题调试，不执行视频/文章任务。");
       return;
     }
     
     // 在一次运行中可能发生遗漏，我们重试最多2轮，确保积分刷满
     let loops = 0;
     while (loops < 2) {
       scores = await getTargetScores(page);
        const targetArticle = Math.ceil((scores.article.max - Math.min(scores.article.current, scores.article.max)) / 2);
        const targetVideo = Math.ceil((scores.video.max - Math.min(scores.video.current, scores.video.max)) / 2);
       
       if (targetArticle <= 0 && targetVideo <= 0) {
           console.log("所有自动分项均已爆满！结束今日学习。");
           break;
       }

       if (targetVideo > 0) {
           console.log(`\n=======================`);
           console.log(`执行第 ${loops + 1} 轮：还需要完成 ${targetVideo} 个视频观看`);
           await runVideoTask(page, targetVideo, history);
       }
       
       if (targetArticle > 0) {
           console.log(`\n=======================`);
           console.log(`执行第 ${loops + 1} 轮：还需要完成 ${targetArticle} 篇长文阅读`);
           await runArticleTask(page, targetArticle, history);
       }

       loops++;
     }

     scores = await getTargetScores(page);
     console.log("=======================\n最终检验得分：", JSON.stringify(scores, null, 2));
  } catch (err) {
     console.error("运行时异常中断:", err);
  } finally {
     await engine.close();
     logger.flush();
     process.exit(0);
  }
}

main();
