import { loadTraceDocument, saveTraceDocument, createEmptyTrace } from '../storage/dataStore.ts';
import type { AreaTag, TraceCallEntry, TraceDocument, TraceSummary } from '../types/planguard.ts';

function computeSummary(doc: TraceDocument): TraceSummary {
  const callsGroupedByArea: Record<AreaTag, number> = {
    reading: 0,
    venue: 0,
    schedule: 0,
    food: 0,
    judging: 0,
    budget: 0,
  };

  const modelsSet = new Set<string>();
  let totalInput = 0;
  let totalOutput = 0;
  let totalAll = 0;
  let anyUnavailable = false;

  for (const call of doc.calls) {
    callsGroupedByArea[call.areaTag] = (callsGroupedByArea[call.areaTag] || 0) + 1;
    modelsSet.add(call.modelName);

    if (
      call.tokenUsageAvailable &&
      typeof call.inputTokens === 'number' &&
      typeof call.outputTokens === 'number' &&
      typeof call.totalTokens === 'number'
    ) {
      totalInput += call.inputTokens;
      totalOutput += call.outputTokens;
      totalAll += call.totalTokens;
    } else {
      anyUnavailable = true;
    }
  }

  return {
    totalCalls: doc.calls.length,
    totalInputTokens: doc.calls.length === 0 ? 0 : anyUnavailable && totalInput === 0 ? null : totalInput,
    totalOutputTokens: doc.calls.length === 0 ? 0 : anyUnavailable && totalOutput === 0 ? null : totalOutput,
    totalTokens: doc.calls.length === 0 ? 0 : anyUnavailable && totalAll === 0 ? null : totalAll,
    tokenCountComplete: !anyUnavailable,
    modelsUsed: Array.from(modelsSet),
    callsGroupedByArea,
    decisionExplanations: doc.summary.decisionExplanations || [],
  };
}

export function getTrace(): TraceDocument {
  const doc = loadTraceDocument();
  doc.summary = computeSummary(doc);
  return doc;
}

export function clearTrace(): TraceDocument {
  const empty = createEmptyTrace();
  saveTraceDocument(empty);
  return empty;
}

export function recordModelCall(entry: Omit<TraceCallEntry, 'callNumber'>): TraceCallEntry {
  const doc = loadTraceDocument();
  const nextNumber = doc.calls.length + 1;
  const fullEntry: TraceCallEntry = {
    callNumber: nextNumber,
    ...entry,
  };
  doc.calls.push(fullEntry);
  doc.updatedAt = new Date().toISOString();
  doc.summary = computeSummary(doc);
  saveTraceDocument(doc);
  return fullEntry;
}

export function recordDecisionExplanation(item: {
  timestamp: string;
  messageId: string;
  status: string;
  classification: string;
  reason: string;
}): void {
  const doc = loadTraceDocument();
  doc.summary.decisionExplanations.push(item);
  doc.updatedAt = new Date().toISOString();
  doc.summary = computeSummary(doc);
  saveTraceDocument(doc);
}
