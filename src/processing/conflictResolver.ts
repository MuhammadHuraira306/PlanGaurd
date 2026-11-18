import { invokeModel } from '../ai/modelWrapper.ts';
import type { RunCallBudget } from '../ai/modelWrapper.ts';
import {
  buildConflictPrompt,
  CONFLICT_RESPONSE_SCHEMA,
  CONFLICT_SYSTEM_INSTRUCTION,
} from '../ai/prompts.ts';
import type { AmbiguousConflictPair } from '../ai/prompts.ts';
import {
  extractNumericFromFact,
  getActiveFactByKey,
  getActiveFacts,
  isActiveFactStatus,
  transitionFactStatus,
} from './contextManager.ts';
import { recordDecisionExplanation } from '../trace/traceManager.ts';
import type {
  ConflictClassification,
  ConflictRecord,
  ExtractedFact,
  ModelConfig,
  ParsedMessage,
} from '../types/planguard.ts';

const AUTHORITY_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unverified: 0,
};

function computeRequiredFoodHeadcount(facts: ExtractedFact[]): number {
  const active = getActiveFacts(facts, 'attendance');
  const totalFact = active.find((f) => f.factKey === 'attendance.total_people');
  if (totalFact) {
    const n = extractNumericFromFact(totalFact);
    if (n && n > 0) return n;
  }

  let sum = 0;
  for (const key of [
    'attendance.students',
    'attendance.judges',
    'attendance.organizers',
    'attendance.volunteers',
    'attendance.guests',
    'attendance.mentors',
  ]) {
    const f = active.find((x) => x.factKey === key);
    const n = f ? extractNumericFromFact(f) : null;
    if (n && n > 0) sum += n;
  }
  // Also include judging.available_judges if attendance.judges wasn't separately stated
  if (!active.some((f) => f.factKey === 'attendance.judges')) {
    const j = getActiveFactByKey(facts, 'judging.available_judges');
    const jn = j ? extractNumericFromFact(j) : null;
    if (jn && jn > 0) sum += jn;
  }
  return sum;
}

function tryParseTimestampMs(ts: string): number | null {
  if (!ts || ts === 'Unspecified') return null;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? null : parsed;
}

function valuesEquivalent(a: ExtractedFact, b: ExtractedFact): boolean {
  const numA = extractNumericFromFact(a);
  const numB = extractNumericFromFact(b);
  if (numA !== null && numB !== null) {
    return numA === numB && (a.unit || '') === (b.unit || '');
  }
  const strA = String(a.operationalValue ?? a.value).toLowerCase().trim();
  const strB = String(b.operationalValue ?? b.value).toLowerCase().trim();
  return strA === strB;
}

function createConflictRecord(params: {
  classification: ConflictClassification;
  existingFact: ExtractedFact | null;
  incomingFact: ExtractedFact;
  selectedInfo: string;
  selectedFactId: string | null;
  reason: string;
  finalStatus: ExtractedFact['status'];
  requiresHumanVerification?: boolean;
}): ConflictRecord {
  return {
    id: `CONF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    classification: params.classification,
    category: params.incomingFact.category,
    factKey: params.incomingFact.factKey,
    originalFactId: params.existingFact?.id ?? null,
    originalInfo: params.existingFact
      ? `${params.existingFact.summary} (${String(params.existingFact.operationalValue ?? params.existingFact.value)})`
      : 'No prior conflicting fact',
    incomingFactId: params.incomingFact.id,
    incomingInfo: `${params.incomingFact.summary} (${String(params.incomingFact.operationalValue ?? params.incomingFact.value)})`,
    selectedInfo: params.selectedInfo,
    selectedFactId: params.selectedFactId,
    source: `${params.incomingFact.sender} (${params.incomingFact.senderRole}, authority: ${params.incomingFact.authorityAssessment})`,
    reason: params.reason,
    finalStatus: params.finalStatus,
    requiresHumanVerification: Boolean(params.requiresHumanVerification),
  };
}

function checkHardConstraintViolation(
  incoming: ExtractedFact,
  currentFacts: ExtractedFact[],
): { violated: boolean; reason: string } {
  // 1. Food order quantity cannot be less than required attendance headcount
  if (incoming.factKey === 'food.order_quantity' || incoming.factKey === 'food.boxes') {
    const qty = extractNumericFromFact(incoming);
    const requiredHeadcount = computeRequiredFoodHeadcount(currentFacts);
    if (qty !== null && requiredHeadcount > 0 && qty < requiredHeadcount) {
      return {
        violated: true,
        reason: `Rejected insufficient food quantity (${qty}) against required total headcount (${requiredHeadcount} people). Keeping full headcount coverage.`,
      };
    }
  }

  // 2. Non-positive attendance or negative costs
  if (
    (incoming.category === 'attendance' || incoming.category === 'budget') &&
    incoming.numericValue !== null &&
    incoming.numericValue < 0
  ) {
    return {
      violated: true,
      reason: `Rejected invalid negative value (${incoming.numericValue}) for ${incoming.factKey}.`,
    };
  }

  return { violated: false, reason: '' };
}

export async function resolveAndMergeFacts(params: {
  existingFacts: ExtractedFact[];
  incomingFacts: ExtractedFact[];
  messages: ParsedMessage[];
  intentByMessageId: Record<string, string>;
  modelConfig: ModelConfig;
  budget: RunCallBudget;
}): Promise<{
  facts: ExtractedFact[];
  conflicts: ConflictRecord[];
  changedFactKeys: string[];
}> {
  const facts = [...params.existingFacts];
  const newConflicts: ConflictRecord[] = [];
  const changedFactKeys = new Set<string>();
  const ambiguousPairs: Array<{ pair: AmbiguousConflictPair; msg: ParsedMessage | undefined }> = [];
  const msgMap = new Map(params.messages.map((m) => [m.id, m]));

  for (const incoming of params.incomingFacts) {
    const msg = msgMap.get(incoming.originalMessageId);
    const intent = params.intentByMessageId[incoming.originalMessageId] || 'new_info';

    // Case 1: Irrelevant
    if (incoming.category === 'irrelevant' || incoming.status === 'Irrelevant') {
      facts.push(incoming);
      if (msg) {
        msg.processingStatus = 'irrelevant';
        msg.decisionReason = incoming.reason;
      }
      recordDecisionExplanation({
        timestamp: new Date().toISOString(),
        messageId: incoming.originalMessageId,
        status: 'Irrelevant',
        classification: 'irrelevant_message',
        reason: incoming.reason,
      });
      continue;
    }

    // Case 2: Check deterministic hard constraint violations BEFORE merging
    const constraintCheck = checkHardConstraintViolation(incoming, facts);
    if (constraintCheck.violated) {
      transitionFactStatus(incoming, 'Rejected', constraintCheck.reason, incoming.originalMessageId);
      facts.push(incoming);
      const existing = getActiveFactByKey(facts, incoming.factKey) || null;
      const conf = createConflictRecord({
        classification: 'misleading_statement',
        existingFact: existing,
        incomingFact: incoming,
        selectedInfo: existing
          ? `${existing.summary} (retained)`
          : 'Retained attendance-based food coverage requirement',
        selectedFactId: existing?.id ?? null,
        reason: constraintCheck.reason,
        finalStatus: 'Rejected',
      });
      newConflicts.push(conf);
      recordDecisionExplanation({
        timestamp: conf.timestamp,
        messageId: incoming.originalMessageId,
        status: 'Rejected',
        classification: conf.classification,
        reason: conf.reason,
      });
      continue;
    }

    // Case 3: Venue options or independent list items (options coexist; don't overwrite distinct venue options)
    if (incoming.constraintType === 'option' || incoming.factKey.startsWith('venue.option_')) {
      const sameKeyActive = getActiveFactByKey(facts, incoming.factKey);
      if (!sameKeyActive) {
        const status = incoming.authorityAssessment === 'unverified' ? 'Accepted' : 'Confirmed';
        transitionFactStatus(
          incoming,
          status,
          'Venue/option added to candidate pool',
          incoming.originalMessageId,
        );
        facts.push(incoming);
        changedFactKeys.add(incoming.factKey);
        continue;
      }
    }

    // Case 4: Check if there is an active fact with the same factKey
    const existing = getActiveFactByKey(facts, incoming.factKey);
    if (!existing) {
      // Operational vs announced clarification on a fresh key
      if (incoming.announcedValue && incoming.operationalValue && incoming.announcedValue !== incoming.operationalValue) {
        const reason = `Operational value "${incoming.operationalValue}" adopted over announced "${incoming.announcedValue}" per authoritative clarification.`;
        transitionFactStatus(incoming, 'Confirmed', reason, incoming.originalMessageId);
        facts.push(incoming);
        changedFactKeys.add(incoming.factKey);
        const conf = createConflictRecord({
          classification: 'operational_clarification',
          existingFact: null,
          incomingFact: incoming,
          selectedInfo: `${incoming.operationalValue} (announced: ${incoming.announcedValue})`,
          selectedFactId: incoming.id,
          reason,
          finalStatus: 'Confirmed',
        });
        newConflicts.push(conf);
        recordDecisionExplanation({
          timestamp: conf.timestamp,
          messageId: incoming.originalMessageId,
          status: 'Confirmed',
          classification: conf.classification,
          reason,
        });
        continue;
      }

      if (incoming.authorityAssessment === 'low' && intent === 'unverified_claim') {
        const reason = 'Low-authority unverified claim flagged for human verification before applying to plan.';
        transitionFactStatus(incoming, 'Unverified', reason, incoming.originalMessageId);
        facts.push(incoming);
        const conf = createConflictRecord({
          classification: 'unauthorized_instruction',
          existingFact: null,
          incomingFact: incoming,
          selectedInfo: 'Pending human verification',
          selectedFactId: null,
          reason,
          finalStatus: 'Unverified',
          requiresHumanVerification: true,
        });
        newConflicts.push(conf);
        continue;
      }

      const initialStatus = incoming.authorityAssessment === 'high' ? 'Confirmed' : 'Accepted';
      transitionFactStatus(
        incoming,
        initialStatus,
        `Accepted from ${incoming.sender} (${incoming.authorityAssessment} authority)`,
        incoming.originalMessageId,
      );
      facts.push(incoming);
      changedFactKeys.add(incoming.factKey);
      continue;
    }

    // Case 5: Existing active fact exists for same factKey!
    if (valuesEquivalent(existing, incoming)) {
      const reason = `Corroborates existing fact ${existing.id} with consistent value.`;
      transitionFactStatus(incoming, 'Accepted', reason, incoming.originalMessageId);
      // Do not overwrite, just confirm existing if incoming is higher authority
      if (AUTHORITY_RANK[incoming.authorityAssessment] > AUTHORITY_RANK[existing.authorityAssessment]) {
        transitionFactStatus(existing, 'Confirmed', `Corroborated by higher authority (${incoming.sender})`, incoming.originalMessageId);
      }
      facts.push(incoming);
      continue;
    }

    // Values differ -> Resolve conflict!
    const existingRank = AUTHORITY_RANK[existing.authorityAssessment] ?? 0;
    const incomingRank = AUTHORITY_RANK[incoming.authorityAssessment] ?? 0;
    const existingTs = tryParseTimestampMs(existing.timestamp);
    const incomingTs = tryParseTimestampMs(incoming.timestamp);

    // 5a. Low/unverified authority trying to override medium/high authority -> Reject unauthorized
    if (incomingRank < existingRank && incomingRank <= 1 && msg?.sourceType !== 'external_authoritative_clarification') {
      const reason = `Rejected instruction from ${incoming.sender} (${incoming.authorityAssessment} authority); insufficient authority to override ${existing.sender} (${existing.authorityAssessment} authority).`;
      transitionFactStatus(incoming, 'Rejected', reason, incoming.originalMessageId);
      facts.push(incoming);
      const conf = createConflictRecord({
        classification: 'unauthorized_instruction',
        existingFact: existing,
        incomingFact: incoming,
        selectedInfo: `${existing.summary} (${String(existing.operationalValue ?? existing.value)})`,
        selectedFactId: existing.id,
        reason,
        finalStatus: 'Rejected',
      });
      newConflicts.push(conf);
      recordDecisionExplanation({
        timestamp: conf.timestamp,
        messageId: incoming.originalMessageId,
        status: 'Rejected',
        classification: conf.classification,
        reason,
      });
      continue;
    }

    // 5b. Incoming timestamp is strictly older than existing -> Outdated announcement
    if (existingTs !== null && incomingTs !== null && incomingTs < existingTs && intent !== 'explicit_correction') {
      const reason = `Incoming message timestamp (${incoming.timestamp}) predates active fact (${existing.timestamp}); marked Outdated.`;
      transitionFactStatus(incoming, 'Outdated', reason, incoming.originalMessageId);
      facts.push(incoming);
      const conf = createConflictRecord({
        classification: 'outdated_announcement',
        existingFact: existing,
        incomingFact: incoming,
        selectedInfo: `${existing.summary} (${String(existing.operationalValue ?? existing.value)})`,
        selectedFactId: existing.id,
        reason,
        finalStatus: 'Outdated',
      });
      newConflicts.push(conf);
      recordDecisionExplanation({
        timestamp: conf.timestamp,
        messageId: incoming.originalMessageId,
        status: 'Outdated',
        classification: conf.classification,
        reason,
      });
      continue;
    }

    // 5c. Authoritative operational clarification or explicit correction / genuine update from >= authority
    if (
      msg?.sourceType === 'external_authoritative_clarification' ||
      intent === 'explicit_correction' ||
      (incoming.announcedValue && incoming.operationalValue) ||
      (incomingRank >= existingRank && (intent === 'update' || incomingRank >= 2))
    ) {
      const classification: ConflictClassification =
        incoming.announcedValue && incoming.operationalValue
          ? 'operational_clarification'
          : intent === 'explicit_correction'
            ? 'explicit_correction'
            : 'genuine_update';

      const operationalStr = String(incoming.operationalValue ?? incoming.value);
      const reason =
        classification === 'operational_clarification'
          ? `Operational clarification from ${incoming.sender} sets effective value to "${operationalStr}" (announced: "${incoming.announcedValue}"), superseding prior "${String(existing.operationalValue ?? existing.value)}".`
          : `${classification.replace('_', ' ')} from ${incoming.sender} (${incoming.authorityAssessment} authority) supersedes "${String(existing.operationalValue ?? existing.value)}" with "${operationalStr}".`;

      existing.supersededByFactId = incoming.id;
      transitionFactStatus(existing, 'Superseded', reason, incoming.originalMessageId);
      transitionFactStatus(incoming, 'Confirmed', reason, incoming.originalMessageId);
      facts.push(incoming);
      changedFactKeys.add(incoming.factKey);

      const conf = createConflictRecord({
        classification,
        existingFact: existing,
        incomingFact: incoming,
        selectedInfo: operationalStr,
        selectedFactId: incoming.id,
        reason,
        finalStatus: 'Confirmed',
      });
      newConflicts.push(conf);
      recordDecisionExplanation({
        timestamp: conf.timestamp,
        messageId: incoming.originalMessageId,
        status: 'Confirmed',
        classification,
        reason,
      });
      continue;
    }

    // 5d. Ambiguous conflict -> queue for compact AI conflict resolution (only if budget permits)
    facts.push(incoming);
    ambiguousPairs.push({
      pair: {
        pairId: `PAIR-${ambiguousPairs.length + 1}`,
        factKey: incoming.factKey,
        existingFact: existing,
        incomingFact: incoming,
      },
      msg,
    });
  }

  // Batched AI disambiguation ONLY if genuinely ambiguous conflicts exist
  if (ambiguousPairs.length > 0 && params.budget.callsUsed < params.budget.maxCalls) {
    try {
      const res = await invokeModel<{
        resolutions: Array<{
          pairId: string;
          classification: ConflictClassification;
          winner: 'incoming' | 'existing' | 'human_verification_needed';
          reason: string;
        }>;
      }>({
        budget: params.budget,
        config: params.modelConfig,
        areaTag: 'reading',
        purpose: `Resolve ${ambiguousPairs.length} ambiguous fact conflict(s)`,
        systemInstruction: CONFLICT_SYSTEM_INSTRUCTION,
        prompt: buildConflictPrompt(ambiguousPairs.map((x) => x.pair)),
        responseSchema: CONFLICT_RESPONSE_SCHEMA,
        expectJson: true,
      });

      const resMap = new Map((res.parsed?.resolutions || []).map((r) => [r.pairId, r]));
      for (const { pair } of ambiguousPairs) {
        const decision = resMap.get(pair.pairId);
        if (!decision || decision.winner === 'human_verification_needed') {
          transitionFactStatus(
            pair.incomingFact,
            'Conflicting',
            decision?.reason || 'Ambiguous contradiction requiring human verification',
            pair.incomingFact.originalMessageId,
          );
          const conf = createConflictRecord({
            classification: decision?.classification || 'contradiction',
            existingFact: pair.existingFact,
            incomingFact: pair.incomingFact,
            selectedInfo: `${pair.existingFact.summary} (retained pending verification)`,
            selectedFactId: pair.existingFact.id,
            reason: decision?.reason || 'Flagged for human verification',
            finalStatus: 'Conflicting',
            requiresHumanVerification: true,
          });
          newConflicts.push(conf);
        } else if (decision.winner === 'incoming') {
          pair.existingFact.supersededByFactId = pair.incomingFact.id;
          transitionFactStatus(pair.existingFact, 'Superseded', decision.reason, pair.incomingFact.originalMessageId);
          transitionFactStatus(pair.incomingFact, 'Confirmed', decision.reason, pair.incomingFact.originalMessageId);
          changedFactKeys.add(pair.factKey);
          newConflicts.push(
            createConflictRecord({
              classification: decision.classification,
              existingFact: pair.existingFact,
              incomingFact: pair.incomingFact,
              selectedInfo: String(pair.incomingFact.operationalValue ?? pair.incomingFact.value),
              selectedFactId: pair.incomingFact.id,
              reason: decision.reason,
              finalStatus: 'Confirmed',
            }),
          );
        } else {
          transitionFactStatus(pair.incomingFact, 'Rejected', decision.reason, pair.incomingFact.originalMessageId);
          newConflicts.push(
            createConflictRecord({
              classification: decision.classification,
              existingFact: pair.existingFact,
              incomingFact: pair.incomingFact,
              selectedInfo: String(pair.existingFact.operationalValue ?? pair.existingFact.value),
              selectedFactId: pair.existingFact.id,
              reason: decision.reason,
              finalStatus: 'Rejected',
            }),
          );
        }
      }
    } catch {
      for (const { pair } of ambiguousPairs) {
        transitionFactStatus(
          pair.incomingFact,
          'Conflicting',
          'Conflict flagged for human verification',
          pair.incomingFact.originalMessageId,
        );
      }
    }
  } else if (ambiguousPairs.length > 0) {
    for (const { pair } of ambiguousPairs) {
      transitionFactStatus(
        pair.incomingFact,
        'Conflicting',
        'Flagged for human verification (model call budget preserved)',
        pair.incomingFact.originalMessageId,
      );
    }
  }

  // Re-evaluate message processingStatus based on their extracted facts
  for (const msg of params.messages) {
    const msgFacts = facts.filter((f) => f.originalMessageId === msg.id);
    if (msgFacts.length === 0) continue;

    const activeCount = msgFacts.filter((f) => isActiveFactStatus(f.status)).length;
    const rejectedCount = msgFacts.filter((f) => f.status === 'Rejected').length;
    const conflictingCount = msgFacts.filter((f) => f.status === 'Conflicting' || f.status === 'Unverified').length;
    const outdatedCount = msgFacts.filter((f) => f.status === 'Outdated').length;
    const supersededCount = msgFacts.filter((f) => f.status === 'Superseded').length;
    const irrelevantCount = msgFacts.filter((f) => f.status === 'Irrelevant').length;

    if (irrelevantCount === msgFacts.length) {
      msg.processingStatus = 'irrelevant';
      msg.decisionReason = msgFacts[0].reason;
    } else if (rejectedCount === msgFacts.length) {
      msg.processingStatus = 'rejected';
      msg.decisionReason = msgFacts.map((f) => f.reason).join(' | ');
    } else if (outdatedCount === msgFacts.length) {
      msg.processingStatus = 'outdated' as ParsedMessage['processingStatus'];
      msg.decisionReason = msgFacts.map((f) => f.reason).join(' | ');
    } else if (conflictingCount > 0 && activeCount === 0) {
      msg.processingStatus = 'conflicting';
      msg.decisionReason = msgFacts.map((f) => f.reason).join(' | ');
    } else if (activeCount > 0 && (rejectedCount > 0 || conflictingCount > 0)) {
      msg.processingStatus = 'partially_accepted';
      msg.decisionReason = msgFacts.map((f) => `[${f.status}] ${f.reason}`).join(' | ');
    } else if (supersededCount === msgFacts.length) {
      msg.processingStatus = 'superseded';
      msg.decisionReason = msgFacts.map((f) => f.reason).join(' | ');
    } else {
      msg.processingStatus = 'accepted';
      msg.decisionReason = msgFacts.map((f) => f.reason).join(' | ');
    }
  }

  return {
    facts,
    conflicts: newConflicts,
    changedFactKeys: Array.from(changedFactKeys),
  };
}
