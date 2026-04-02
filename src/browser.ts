import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer-core";
import { type IConfig } from "./config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

puppeteer.use(StealthPlugin());

export class BrowserEngine {
  private browser: Browser | null = null;
  public page: Page | null = null;

  private getDefaultChromePath(): string {
    const paths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "/usr/bin/google-chrome"
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error("Cannot find default Chrome path, please set `chromePath` in config.yaml");
  }

  private getDefaultChromeUserDataDir(): string {
    const home = os.homedir();
    const platform = process.platform;

    if (platform === "darwin") {
      return path.join(home, "Library", "Application Support", "Google", "Chrome");
    }
    if (platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA;
      if (!localAppData) {
        throw new Error("Cannot determine LOCALAPPDATA for Chrome profile discovery");
      }
      return path.join(localAppData, "Google", "Chrome", "User Data");
    }
    return path.join(home, ".config", "google-chrome");
  }

  async init(config: IConfig) {
    const execPath = config.chromePath || this.getDefaultChromePath();
    const profileStrategy = config.browserProfile?.strategy ?? "system";
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      `--window-size=${config.viewport.width},${config.viewport.height}`,
      '--window-position=0,0'
    ];

    let userDataDir: string | undefined;
    if (profileStrategy === "system") {
      userDataDir = config.browserProfile?.userDataDir || this.getDefaultChromeUserDataDir();
      if (config.browserProfile?.profileDirectory) {
        launchArgs.push(`--profile-directory=${config.browserProfile.profileDirectory}`);
      }
    } else {
      userDataDir = config.browserProfile?.userDataDir || "./chrome_data";
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      if (config.browserProfile?.profileDirectory) {
        launchArgs.push(`--profile-directory=${config.browserProfile.profileDirectory}`);
      }
    }

    this.browser = await puppeteer.launch({
      executablePath: execPath,
      headless: false,
      userDataDir,
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: null,
      args: launchArgs
    }) as unknown as Browser;

    const pages = await this.browser.pages();
    this.page = pages[0] || await this.browser.newPage();

    // 强制设置一次 Viewport 以确保渲染分辨率符合预期
    await this.page.setViewport({
      width: config.viewport.width,
      height: config.viewport.height,
      deviceScaleFactor: 1,
    });
  }

  async close() {
    if (this.browser) await this.browser.close();
  }
}
