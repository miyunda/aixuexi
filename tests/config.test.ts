import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { loadConfig } from "../src/config";
import { writeFileSync, unlinkSync } from "fs";

describe("Config Parser", () => {
  const testFile = "test_config.yaml";
  const legacyTestFile = "test_config_legacy.yaml";
  beforeAll(() => writeFileSync(testFile, "viewport:\n  width: 1920\n  height: 1080\nbrowserProfile:\n  strategy: local\n  profileDirectory: Profile 1\nquiz:\n  mode: semi-auto\n  videoPreviewSeconds: 15\n  llmEnabled: false\n"));
  beforeAll(() => writeFileSync(legacyTestFile, "exam:\n  mode: semi-auto\n  videoPreviewSeconds: 12\n"));
  afterAll(() => unlinkSync(testFile));
  afterAll(() => unlinkSync(legacyTestFile));

  test("should parse yaml config", () => {
    const config = loadConfig(testFile);
    expect(config.viewport.width).toBe(1920);
    expect(config.viewport.height).toBe(1080);
    expect(config.browserProfile?.strategy).toBe("local");
    expect(config.browserProfile?.profileDirectory).toBe("Profile 1");
    expect(config.logRetentionDays).toBe(365);
    expect(config.quiz?.mode).toBe("semi-auto");
    expect(config.quiz?.videoPreviewSeconds).toBe(15);
    expect(config.quiz?.llmEnabled).toBe(false);
  });

  test("should keep reading legacy exam config as quiz", () => {
    const config = loadConfig(legacyTestFile);
    expect(config.quiz?.mode).toBe("semi-auto");
    expect(config.quiz?.videoPreviewSeconds).toBe(12);
    expect(config.quiz?.llmEnabled).toBe(true);
  });
});
