import { describe, expect, test } from "bun:test";
import { isLlmConfigured, parseLlmAnswerContent, shouldRetryStatus } from "../src/llm";

describe("llm helpers", () => {
  test("parses json answer payload", () => {
    expect(parseLlmAnswerContent('{"answers":["错误"],"confidence":0.91,"reason":"题干与提示矛盾"}')).toEqual({
      answers: ["错误"],
      confidence: 0.91,
      reason: "题干与提示矛盾",
    });
  });

  test("parses fenced json answer payload", () => {
    expect(parseLlmAnswerContent('```json\n{"answer":["A. 正确"]}\n```')).toEqual({
      answers: ["A. 正确"],
      confidence: undefined,
      reason: undefined,
    });
  });

  test("detects llm config from env", () => {
    expect(isLlmConfigured({
      AIXUEXI_LLM_API_KEY: "k",
      AIXUEXI_LLM_BASE_URL: "https://api.example.com/v1",
      AIXUEXI_LLM_MODEL: "m",
    } as NodeJS.ProcessEnv)).toBe(true);
  });

  test("retries on throttling and server errors only", () => {
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(500)).toBe(true);
    expect(shouldRetryStatus(503)).toBe(true);
    expect(shouldRetryStatus(400)).toBe(false);
  });
});
