import type { Page } from "puppeteer-core";

export async function checkAndLogin(page: Page): Promise<void> {
  console.log("正在检查登录状态...");
  await page.goto("https://pc.xuexi.cn/points/login.html", { waitUntil: 'networkidle2' });
  
  try {
     await page.waitForFunction(() => {
        return document.querySelector('.logged-text') !== null || document.querySelector('iframe') !== null;
     }, { timeout: 10000 });
  } catch(e) {}

  const currentUrl = page.url();
  if (currentUrl.includes('login.html')) {
     console.log("\x07\n====== 请在弹出的浏览器中扫码登录 ======\n");
     // 等待直到 URL 不再是 login.html，即代表扫码成功并发生了跳转
     await page.waitForFunction(() => {
         return !window.location.href.includes('login.html');
     }, { timeout: 0 }); // 无限等待扫码完成
     console.log("登录成功！");
  } else {
     console.log("已验证处于有效登录状态。");
  }
}
