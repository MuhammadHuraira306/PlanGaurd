import type { ExtractedFact, FactCategory, FactStatus } from '../types/planguard.ts';

export function isActiveFactStatus(status: FactStatus): boolean {
  return status === 'Confirmed' || status === 'Accepted';
}

export function getActiveFacts(facts: ExtractedFact[], category?: FactCategory): ExtractedFact[] {
  return facts.filter((f) => isActiveFactStatus(f.status) && (!category || f.category === category));
}

export function getActiveFactByKey(facts: ExtractedFact[], factKey: string): ExtractedFact | undefined {
  return facts.find((f) => f.factKey === factKey && isActiveFactStatus(f.status));
}

export function transitionFactStatus(
  fact: ExtractedFact,
  newStatus: FactStatus,
  reason: string,
  triggeredByMessageId: string,
): void {
  const prev = fact.status;
  fact.status = newStatus;
  fact.reason = reason;
  fact.history.push({
    timestamp: new Date().toISOString(),
    previousStatus: prev,
    newStatus,
    reason,
    triggeredByMessageId,
  });
}

export function extractNumericFromFact(fact: ExtractedFact): number | null {
  if (typeof fact.numericValue === 'number' && !Number.isNaN(fact.numericValue)) {
    return fact.numericValue;
  }
  if (typeof fact.value === 'number' && !Number.isNaN(fact.value)) {
    return fact.value;
  }
  if (typeof fact.value === 'string') {
    const cleaned = fact.value.replace(/,/g, '');
    const m = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return null;
}

export function buildCompactStateSummary(facts: ExtractedFact[]): Record<string, unknown> {
  const active = getActiveFacts(facts);
  const summary: Record<string, unknown> = {};
  for (const f of active) {
    summary[f.factKey] = {
      value: f.operationalValue || f.value,
      numericValue: f.numericValue,
      unit: f.unit,
      sender: f.sender,
      authority: f.authorityAssessment,
    };
  }
  return summary;
}
