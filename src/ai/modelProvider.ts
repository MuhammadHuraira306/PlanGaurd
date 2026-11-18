import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { GenerateContentResponse } from '@google/genai';
import type { ModelConfig } from '../types/planguard.ts';

export interface RawProviderCallParams {
  config: ModelConfig;
  systemInstruction: string;
  prompt: string;
  responseSchema?: Record<string, unknown>;
  expectJson?: boolean;
}

export interface RawProviderResponse {
  actualModelName: string;
  provider: 'gemini' | 'local';
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  tokenUsageAvailable: boolean;
  tokenUsageNote?: string;
}

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | undefined;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add a valid GEMINI_API_KEY in the Settings > Secrets panel.',
    );
  }
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedKey = apiKey;
  }
  return cachedClient;
}

export const SUPPORTED_MODELS = [
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini' as const,
    label: 'Gemini 3.1 Flash Lite',
    tier: 'Small / Ultra-Fast',
    notes: 'Minimal thinking overhead, lowest token consumption and latency.',
  },
  {
    id: 'gemini-4-hydrogen',
    provider: 'gemini' as const,
    label: 'Gemini 4 Hydrogen',
    tier: 'Small-to-Mid Flash',
    notes: 'Strong multilingual & Roman Urdu reasoning with configurable ThinkingLevel.LOW.',
  },
];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiWithRetry(params: RawProviderCallParams): Promise<RawProviderResponse> {
  const ai = getGeminiClient();
  const modelName = params.config.modelName || 'gemini-3.1-flash-lite';

  const configObj: Record<string, unknown> = {
    systemInstruction: params.systemInstruction,
  };

  if (params.expectJson !== false) {
    configObj.responseMimeType = 'application/json';
  }
  if (params.responseSchema) {
    configObj.responseSchema = params.responseSchema;
  }
  if (modelName === 'gemini-4-hydrogen') {
    configObj.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: modelName,
        contents: params.prompt,
        config: configObj,
      });

      const text = (response.text ?? '').trim();
      const usage = response.usageMetadata as
        | {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            thoughtsTokenCount?: number;
            totalTokenCount?: number;
          }
        | undefined;

      const hasPrompt = typeof usage?.promptTokenCount === 'number';
      const hasCand = typeof usage?.candidatesTokenCount === 'number';
      const thoughts = typeof usage?.thoughtsTokenCount === 'number' ? usage.thoughtsTokenCount : 0;

      const inputTokens = hasPrompt ? usage!.promptTokenCount! : null;
      const outputTokens = hasCand ? usage!.candidatesTokenCount! + thoughts : null;
      const totalTokens =
        typeof usage?.totalTokenCount === 'number'
          ? usage.totalTokenCount
          : inputTokens !== null && outputTokens !== null
            ? inputTokens + outputTokens
            : null;

      const tokenUsageAvailable = inputTokens !== null && outputTokens !== null && totalTokens !== null;

      return {
        actualModelName: response.modelVersion || modelName,
        provider: 'gemini',
        text,
        inputTokens,
        outputTokens,
        totalTokens,
        tokenUsageAvailable,
        tokenUsageNote: tokenUsageAvailable
          ? thoughts > 0
            ? `Includes ${thoughts} thinking tokens in output count`
            : undefined
          : 'Token usage metadata was not returned by provider',
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('429') || msg.includes('503') || msg.includes('RESOURCE_EXHAUSTED');
      if (isTransient && attempt < 2) {
        await sleep(600 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Gemini API call failed (${modelName}): ${errMsg}`);
}

async function callLocalEndpoint(params: RawProviderCallParams): Promise<RawProviderResponse> {
  const baseUrl = (params.config.localBaseUrl || process.env.LOCAL_LLM_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('LOCAL_LLM_BASE_URL is not configured for local small-model execution.');
  }
  const modelName = params.config.modelName || process.env.LOCAL_LLM_MODEL || 'qwen2.5:7b';

  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'system', content: params.systemInstruction },
        { role: 'user', content: params.prompt },
      ],
      ...(params.expectJson !== false ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`Local model endpoint error (${res.status}): ${bodyText}`);
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  const hasUsage =
    typeof data.usage?.prompt_tokens === 'number' && typeof data.usage?.completion_tokens === 'number';

  return {
    actualModelName: data.model || modelName,
    provider: 'local',
    text,
    inputTokens: hasUsage ? data.usage!.prompt_tokens! : null,
    outputTokens: hasUsage ? data.usage!.completion_tokens! : null,
    totalTokens:
      hasUsage && typeof data.usage?.total_tokens === 'number'
        ? data.usage.total_tokens
        : hasUsage
          ? data.usage!.prompt_tokens! + data.usage!.completion_tokens!
          : null,
    tokenUsageAvailable: hasUsage,
    tokenUsageNote: hasUsage ? undefined : 'Token usage not reported by local OpenAI-compatible provider',
  };
}

export async function executeModelCall(params: RawProviderCallParams): Promise<RawProviderResponse> {
  if (params.config.provider === 'local') {
    return callLocalEndpoint(params);
  }
  return callGeminiWithRetry(params);
}
