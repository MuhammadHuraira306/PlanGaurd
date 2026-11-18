import { executeModelCall } from './modelProvider.ts';
import { recordModelCall } from '../trace/traceManager.ts';
import type { AreaTag, ModelConfig } from '../types/planguard.ts';

export interface RunCallBudget {
  runId: string;
  runType: 'initial' | 'incremental' | 'resolution';
  maxCalls: number;
  callsUsed: number;
  modelsUsed: Set<string>;
}

export function createRunCallBudget(
  runType: 'initial' | 'incremental' | 'resolution',
  maxCalls = runType === 'incremental' ? 5 : 8,
): RunCallBudget {
  return {
    runId: `${runType}-${Date.now()}`,
    runType,
    maxCalls,
    callsUsed: 0,
    modelsUsed: new Set<string>(),
  };
}

export interface AuditedCallParams {
  budget: RunCallBudget;
  config: ModelConfig;
  areaTag: AreaTag;
  purpose: string;
  systemInstruction: string;
  prompt: string;
  responseSchema?: Record<string, unknown>;
  expectJson?: boolean;
}

export interface AuditedCallResult<T = unknown> {
  rawText: string;
  parsed: T | null;
  modelName: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  tokenUsageAvailable: boolean;
  durationMs: number;
}

function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return stripped.trim();
  }
  return trimmed;
}

export async function invokeModel<T = unknown>(params: AuditedCallParams): Promise<AuditedCallResult<T>> {
  if (params.budget.callsUsed >= params.budget.maxCalls) {
    throw new Error(
      `Model call budget exceeded (${params.budget.maxCalls} max calls for ${params.budget.runType} run). Deterministic fallback or partial update must handle remaining checks.`,
    );
  }

  params.budget.callsUsed += 1;
  const startedAt = Date.now();

  try {
    const res = await executeModelCall({
      config: params.config,
      systemInstruction: params.systemInstruction,
      prompt: params.prompt,
      responseSchema: params.responseSchema,
      expectJson: params.expectJson,
    });

    const durationMs = Date.now() - startedAt;
    params.budget.modelsUsed.add(res.actualModelName);

    recordModelCall({
      runId: params.budget.runId,
      runType: params.budget.runType,
      modelName: res.actualModelName,
      provider: res.provider,
      areaTag: params.areaTag,
      purpose: params.purpose,
      timestamp: new Date().toISOString(),
      durationMs,
      input: {
        systemInstruction: params.systemInstruction,
        prompt: params.prompt,
        schemaUsed: Boolean(params.responseSchema),
      },
      output: res.text,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      totalTokens: res.totalTokens,
      tokenUsageAvailable: res.tokenUsageAvailable,
      tokenUsageNote: res.tokenUsageNote,
    });

    let parsed: T | null = null;
    if (params.expectJson !== false) {
      try {
        parsed = JSON.parse(extractJsonString(res.text)) as T;
      } catch {
        parsed = null;
      }
    }

    return {
      rawText: res.text,
      parsed,
      modelName: res.actualModelName,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      totalTokens: res.totalTokens,
      tokenUsageAvailable: res.tokenUsageAvailable,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);

    recordModelCall({
      runId: params.budget.runId,
      runType: params.budget.runType,
      modelName: params.config.modelName,
      provider: params.config.provider,
      areaTag: params.areaTag,
      purpose: params.purpose,
      timestamp: new Date().toISOString(),
      durationMs,
      input: {
        systemInstruction: params.systemInstruction,
        prompt: params.prompt,
        schemaUsed: Boolean(params.responseSchema),
      },
      output: '',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      tokenUsageAvailable: false,
      tokenUsageNote: 'Call failed before usage metadata was returned',
      error: errorMessage,
    });

    throw err;
  }
}
