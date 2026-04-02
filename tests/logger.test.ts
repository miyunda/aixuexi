import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { RunLogger } from "../src/logger";

const testLogsDir = path.join(process.cwd(), "test-logs");

afterEach(() => {
  if (fs.existsSync(testLogsDir)) {
    fs.rmSync(testLogsDir, { recursive: true, force: true });
  }
});

describe("RunLogger", () => {
  test("writes log file on flush when retention is enabled", () => {
    const logger = new RunLogger({ retentionDays: 365, logsDir: testLogsDir, mirrorToConsole: false });
    logger.start();
    console.log("hello logger");
    logger.flush();

    expect(fs.existsSync(testLogsDir)).toBe(true);
    const dayDirs = fs.readdirSync(testLogsDir);
    expect(dayDirs.length).toBe(1);
    const files = fs.readdirSync(path.join(testLogsDir, dayDirs[0]!)).filter((name) => name.endsWith(".log"));
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(testLogsDir, dayDirs[0]!, files[0]!), "utf8");
    expect(content.includes("==== AiXuexi Run Log ====")).toBe(true);
    expect(content.includes("hello logger")).toBe(true);
    expect(content.includes("==== End Of Run Log ====")).toBe(true);
  });

  test("does not write log file when retention is disabled", () => {
    const logger = new RunLogger({ retentionDays: 0, logsDir: testLogsDir, mirrorToConsole: false });
    logger.start();
    console.log("do not persist");
    logger.flush();

    expect(fs.existsSync(testLogsDir)).toBe(false);
  });
});
