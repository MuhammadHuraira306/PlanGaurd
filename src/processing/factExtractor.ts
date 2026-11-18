import { invokeModel } from '../ai/modelWrapper.ts';
import type { RunCallBudget } from '../ai/modelWrapper.ts';
import {
  buildExtractionPrompt,
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
} from '../ai/prompts.ts';
import type {
  AuthorityLevel,
  ExtractedFact,
  FactCategory,
  ModelConfig,
  ParsedMessage,
} from '../types/planguard.ts';

interface RawExtractedFactDTO {
  category: string;
  factKey: string;
  summary: string;
  valueString: string;
  numericValue?: number;
  unit?: string;
  currency?: string;
  timeStart?: string;
  timeEnd?: string;
  constraintType?: string;
  isAdministrativeDeadline?: boolean;
  announcedValue?: string;
  operationalValue?: string;
  structuredDetailsJson?: string;
  relatedConstraints?: string[];
  confidence?: number;
  rawQuote?: string;
}

interface RawExtractedMessageDTO {
  messageId: string;
  isRelevant: boolean;
  relevanceReason: string;
  senderIdentified: string;
  senderRole: string;
  authorityLevel: string;
  language: string;
  intentSignal: string;
  facts: RawExtractedFactDTO[];
}

export interface ExtractionBatchResult {
  extractedFacts: ExtractedFact[];
  intentByMessageId: Record<string, string>;
  relevanceByMessageId: Record<string, { isRelevant: boolean; reason: string }>;
}

const VALID_CATEGORIES = new Set<FactCategory>([
  'attendance',
  'venue',
  'schedule',
  'food',
  'judging',
  'budget',
  'administrative_deadline',
  'general_constraint',
  'irrelevant',
]);

function normalizeCategory(cat: string): FactCategory {
  const c = (cat || '').toLowerCase().trim() as FactCategory;
  return VALID_CATEGORIES.has(c) ? c : 'general_constraint';
}

function normalizeAuthority(auth: string, message: ParsedMessage): AuthorityLevel {
  if (message.sourceType === 'external_authoritative_clarification') {
    return 'high';
  }
  const a = (auth || '').toLowerCase().trim();
  if (a === 'high' || a === 'medium' || a === 'low' || a === 'unverified') {
    return a;
  }
  return 'unverified';
}

export async function extractFactsFromMessages(params: {
  messages: ParsedMessage[];
  modelConfig: ModelConfig;
  budget: RunCallBudget;
  existingFactCount: number;
}): Promise<ExtractionBatchResult> {
  if (params.messages.length === 0) {
    return { extractedFacts: [], intentByMessageId: {}, relevanceByMessageId: {} };
  }

  const prompt = buildExtractionPrompt(params.messages);
  const res = await invokeModel<{ messages: RawExtractedMessageDTO[] }>({
    budget: params.budget,
    config: params.modelConfig,
    areaTag: 'reading',
    purpose:
      params.messages.length === 1
        ? `Extract structured facts from incoming message ${params.messages[0].id}`
        : `Extract structured facts from ${params.messages.length} uploaded messages`,
    systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
    prompt,
    responseSchema: EXTRACTION_RESPONSE_SCHEMA,
    expectJson: true,
  });

  if (!res.parsed || !Array.isArray(res.parsed.messages)) {
    throw new Error('Model did not return valid structured fact JSON during message reading.');
  }

  const msgMap = new Map(params.messages.map((m) => [m.id, m]));
  const extractedFacts: ExtractedFact[] = [];
  const intentByMessageId: Record<string, string> = {};
  const relevanceByMessageId: Record<string, { isRelevant: boolean; reason: string }> = {};
  let factCounter = params.existingFactCount;

  for (const item of res.parsed.messages) {
    const msg = msgMap.get(item.messageId);
    if (!msg) continue;

    const authority = normalizeAuthority(item.authorityLevel, msg);
    if (msg.sender === 'Unknown' && item.senderIdentified && item.senderIdentified !== 'Unknown') {
      msg.sender = item.senderIdentified;
    }
    msg.senderRole = item.senderRole || msg.senderRole;
    msg.authorityLevel = authority;
    msg.language =
      item.language === 'en' || item.language === 'roman_urdu' || item.language === 'mixed'
        ? item.language
        : 'en';

    intentByMessageId[msg.id] = item.intentSignal || 'new_info';
    relevanceByMessageId[msg.id] = {
      isRelevant: Boolean(item.isRelevant),
      reason: item.relevanceReason || '',
    };

    if (!item.isRelevant || !Array.isArray(item.facts) || item.facts.length === 0) {
      factCounter += 1;
      const now = new Date().toISOString();
      extractedFacts.push({
        id: `FACT-${String(factCounter).padStart(4, '0')}`,
        category: 'irrelevant',
        factKey: `irrelevant.${msg.id.toLowerCase()}`,
        summary: item.relevanceReason || 'Message flagged as irrelevant to hackathon planning',
        value: msg.body.slice(0, 120),
        numericValue: null,
        unit: null,
        currency: null,
        timeRange: null,
        constraintType: 'info',
        isAdministrativeDeadline: false,
        announcedValue: null,
        operationalValue: null,
        originalMessageId: msg.id,
        sender: msg.sender,
        senderRole: msg.senderRole,
        timestamp: msg.timestamp,
        confidence: 0.9,
        authorityAssessment: authority,
        status: 'Irrelevant',
        relatedConstraints: [],
        reason: item.relevanceReason || 'Irrelevant to event planning',
        rawQuote: msg.body.slice(0, 200),
        history: [
          {
            timestamp: now,
            previousStatus: null,
            newStatus: 'Irrelevant',
            reason: item.relevanceReason || 'Classified as irrelevant during extraction',
            triggeredByMessageId: msg.id,
          },
        ],
      });
      continue;
    }

    for (const rawFact of item.facts) {
      factCounter += 1;
      const now = new Date().toISOString();
      let parsedValue: ExtractedFact['value'] = rawFact.valueString;
      if (rawFact.structuredDetailsJson) {
        try {
          parsedValue = JSON.parse(rawFact.structuredDetailsJson) as Record<string, unknown>;
        } catch {
          parsedValue = rawFact.valueString;
        }
      }

      const category = normalizeCategory(rawFact.category);
      const isAdminDeadline =
        Boolean(rawFact.isAdministrativeDeadline) || category === 'administrative_deadline';

      extractedFacts.push({
        id: `FACT-${String(factCounter).padStart(4, '0')}`,
        category,
        factKey: (rawFact.factKey || `${category}.item_${factCounter}`).toLowerCase().trim(),
        summary: rawFact.summary,
        value: parsedValue,
        numericValue:
          typeof rawFact.numericValue === 'number' && !Number.isNaN(rawFact.numericValue)
            ? rawFact.numericValue
            : null,
        unit: rawFact.unit || null,
        currency: rawFact.currency || null,
        timeRange:
          rawFact.timeStart || rawFact.timeEnd
            ? { start: rawFact.timeStart || null, end: rawFact.timeEnd || null }
            : null,
        constraintType:
          rawFact.constraintType === 'hard' ||
          rawFact.constraintType === 'soft' ||
          rawFact.constraintType === 'option' ||
          rawFact.constraintType === 'info'
            ? rawFact.constraintType
            : 'info',
        isAdministrativeDeadline: isAdminDeadline,
        announcedValue: rawFact.announcedValue || null,
        operationalValue: rawFact.operationalValue || null,
        originalMessageId: msg.id,
        sender: msg.sender,
        senderRole: msg.senderRole,
        timestamp: msg.timestamp,
        confidence: typeof rawFact.confidence === 'number' ? rawFact.confidence : 0.85,
        authorityAssessment: authority,
        status: 'Unverified',
        relatedConstraints: Array.isArray(rawFact.relatedConstraints) ? rawFact.relatedConstraints : [],
        reason: 'Extracted; pending conflict resolution',
        rawQuote: rawFact.rawQuote || msg.body.slice(0, 180),
        history: [
          {
            timestamp: now,
            previousStatus: null,
            newStatus: 'Unverified',
            reason: 'Initial extraction from message',
            triggeredByMessageId: msg.id,
          },
        ],
      });
    }
  }

  return { extractedFacts, intentByMessageId, relevanceByMessageId };
}
