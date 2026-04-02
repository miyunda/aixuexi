export interface LlmQuizRequest {
  stem: string;
  options: string[];
  hintText: string;
  questionType: "single" | "multiple" | "blank" | "unknown";
  blankCount?: number;
}

export interface LlmQuizResponse {
  answers: string[];
  confidence?: number;
  reason?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export function shouldRetryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const sec = Number(value);
  if (Number.isFinite(sec) && sec >= 0) {
    return Math.floor(sec * 1000);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseLlmAnswerContent(content: string): LlmQuizResponse | null {
  const normalized = normalizeText(content);
  if (!normalized) return null;

  const jsonMatch = normalized.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<LlmQuizResponse> & { answer?: string | string[] };
      const answers =
        Array.isArray(parsed.answers) ? parsed.answers :
        Array.isArray(parsed.answer) ? parsed.answer :
        typeof parsed.answer === "string" ? [parsed.answer] :
        [];
      if (answers.length > 0) {
        return {
          answers: answers.map(normalizeText).filter(Boolean),
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        };
      }
    } catch {}
  }

  const answerLine = normalized.match(/(?:answer|answers|答案)[:：]\s*(.+)$/i);
  if (answerLine?.[1]) {
    return {
      answers: answerLine[1].split(/[|,，]/).map(normalizeText).filter(Boolean),
    };
  }

  return null;
}

function buildPrompt(request: LlmQuizRequest): string {
  return [
    "你是一个严谨的答题助手。请只根据题干、选项和提示内容判断答案。",
    "输出必须是 JSON，不要输出额外说明。",
    "JSON 格式：{\"answers\":[\"...\"],\"confidence\":0.0,\"reason\":\"...\"}",
    "要求：",
    "- 单选题 answers 只放 1 个答案，可以是选项全文，也可以是“正确/错误”这种答案文本。",
    "- 多选题 answers 放多个答案，保持题目顺序。",
    "- 填空题 answers 按空格顺序填写。",
    "- 如果无法可靠判断，answers 返回空数组。",
    "",
    `题型: ${request.questionType}`,
    `题干: ${request.stem}`,
    `选项: ${request.options.join(" | ") || "(无)"}`,
    `提示: ${request.hintText || "(无)"}`,
    request.blankCount ? `空格数量: ${request.blankCount}` : "",
  ].filter(Boolean).join("\n");
}

export function isLlmConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AIXUEXI_LLM_API_KEY && env.AIXUEXI_LLM_BASE_URL && env.AIXUEXI_LLM_MODEL);
}

export async function solveQuizWithLlm(
  request: LlmQuizRequest,
  env: NodeJS.ProcessEnv = process.env
): Promise<LlmQuizResponse | null> {
  const apiKey = env.AIXUEXI_LLM_API_KEY;
  const baseUrl = env.AIXUEXI_LLM_BASE_URL;
  const model = env.AIXUEXI_LLM_MODEL;

  if (!apiKey || !baseUrl || !model) {
    return null;
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: buildPrompt(request),
      },
    ],
  };

  const maxAttempts = 3;
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        lastError = `LLM 请求失败: ${response.status} ${response.statusText}`;
        if (attempt < maxAttempts && shouldRetryStatus(response.status)) {
          const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
          const backoff = retryAfter ?? (500 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 200));
          await sleep(backoff);
          continue;
        }
        throw new Error(lastError);
      }

      const data = await response.json() as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content || "";
      return parseLlmAnswerContent(content);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts) {
        await sleep(500 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 200));
        continue;
      }
      throw new Error(lastError);
    }
  }

  throw new Error(lastError || "LLM 请求失败");
}
