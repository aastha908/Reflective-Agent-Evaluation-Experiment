import type { Scenario } from "./research.js";
import { mockResponse, type MockResponse } from "./research.js";

export type ProviderRequest = {
  provider: string;
  model: string;
  conditionId: string;
  scenario: Scenario;
  messages: { role: string; content: string }[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
};
export type ProviderResult = MockResponse & {
  raw: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
};
export interface ModelProvider {
  complete(request: ProviderRequest): Promise<ProviderResult>;
}

export class MockProvider implements ModelProvider {
  async complete(request: ProviderRequest): Promise<ProviderResult> {
    const start = Date.now();
    const response = mockResponse(request.scenario.id, request.conditionId);
    return {
      ...response,
      raw: JSON.stringify(response),
      latencyMs: Date.now() - start,
    };
  }
}

class OpenAICompatibleProvider implements ModelProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
  ) {}
  async complete(request: ProviderRequest): Promise<ProviderResult> {
    const started = Date.now();
    const tools = request.scenario.tools.map(
      ({ name, description, schema }) => ({
        type: "function",
        function: { name, description, parameters: schema.toJSONSchema() },
      }),
    );
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.key}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          tools,
          tool_choice: "auto",
          temperature: request.temperature ?? 0,
          top_p: request.topP ?? 1,
          max_tokens: request.maxTokens ?? 2048,
        }),
        signal: AbortSignal.timeout((request.timeoutSeconds ?? 120) * 1000),
      },
    );
    if (!response.ok)
      throw new Error(
        `OpenAI-compatible provider returned HTTP ${response.status}`,
      );
    const data = (await response.json()) as {
      choices?: {
        message?: {
          content?: string;
          tool_calls?: { function: { name: string; arguments: string } }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    const call = message?.tool_calls?.[0]?.function;
    return {
      tool: call
        ? {
            name: call.name,
            arguments: JSON.parse(call.arguments) as Record<string, unknown>,
          }
        : undefined,
      final: message?.content ?? "",
      raw: JSON.stringify(data),
      latencyMs: Date.now() - started,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
  }
}

class AnthropicProvider implements ModelProvider {
  async complete(request: ProviderRequest): Promise<ProviderResult> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key)
      throw new Error("ANTHROPIC_API_KEY is not configured on the server");
    const started = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0,
        top_p: request.topP ?? 1,
        system: request.messages[0]?.content,
        messages: request.messages.filter((m) => m.role !== "system"),
        tools: request.scenario.tools.map(({ name, description, schema }) => ({
          name,
          description,
          input_schema: schema.toJSONSchema(),
        })),
      }),
      signal: AbortSignal.timeout((request.timeoutSeconds ?? 120) * 1000),
    });
    if (!response.ok)
      throw new Error(`Anthropic provider returned HTTP ${response.status}`);
    const data = (await response.json()) as {
      content?: {
        type: string;
        text?: string;
        name?: string;
        input?: Record<string, unknown>;
      }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const block = data.content?.find((item) => item.type === "tool_use");
    const final =
      data.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n") ?? "";
    return {
      tool: block?.name
        ? { name: block.name, arguments: block.input ?? {} }
        : undefined,
      final,
      raw: JSON.stringify(data),
      latencyMs: Date.now() - started,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    };
  }
}

export function providerFor(provider: string): ModelProvider {
  if (provider === "mock") return new MockProvider();
  if (provider === "anthropic") return new AnthropicProvider();
  if (provider === "openai" || provider === "openai-compatible") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not configured on the server");
    const url =
      provider === "openai"
        ? "https://api.openai.com/v1"
        : process.env.OPENAI_COMPATIBLE_BASE_URL;
    if (!url)
      throw new Error(
        "OPENAI_COMPATIBLE_BASE_URL is not configured on the server",
      );
    return new OpenAICompatibleProvider(url, key);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}
