import { Type } from '@google/genai';
import type { ExtractedFact, ParsedMessage } from '../types/planguard.ts';

export const EXTRACTION_SYSTEM_INSTRUCTION = `You are PlanGUARD's Message Reading Agent for physical hackathon planning in Islamabad.
Extract structured facts from English, Roman Urdu, or mixed messages (emails, WhatsApp, notices, clarifications).
CRITICAL RULES:
1. Extract ONLY facts explicitly stated in each message. Never invent numbers or assumptions.
2. Identify sender role & authorityLevel:
   - "high": Lead organizer, event director, finance lead/head, official hackathon desk, authorized admin.
   - "medium": Venue coordinator, logistics/catering team, judging coordinator, verified vendor confirming quote.
   - "low": Unofficial forward, peer/student chatter, sponsor promo, tentative suggestion.
   - "unverified": Unknown sender, suspicious unilateral reduction/change, unclear authority.
3. Distinguish teams vs total people (students, judges, organizers, volunteers, guests). Never merge team count with headcount.
4. Distinguish operational deadlines vs announced times! Example: "Code freeze is at 2:00 PM. Please consider it as 1:50 PM" -> announcedValue: "2:00 PM", operationalValue: "1:50 PM", isAdministrativeDeadline: true.
5. Tag administrative deadlines (code freeze, repo commit deadline, registration cutoff) with category "administrative_deadline" and isAdministrativeDeadline: true so they are NOT mixed into physical 4-hour schedule blocks.
6. Use canonical factKeys so updates/conflicts match cleanly:
   - attendance.students, attendance.teams, attendance.judges, attendance.organizers, attendance.guests, attendance.total_people
   - venue.option_<slug> (include capacity, cost, hasGenerator, hasAC, hasWifi, location, restrictions in summary/valueJson), venue.requirement_<slug> (e.g. venue.requirement_generator, venue.requirement_ac, venue.requirement_location)
   - schedule.event_window, schedule.duration_hours, schedule.prayer_break_<name>, schedule.build_duration, schedule.judging_duration, schedule.constraint_<slug>
   - food.unit_price, food.delivery_charge, food.order_quantity, food.meal_type, food.dietary_<slug>, food.coverage_rule
   - judging.available_judges, judging.max_teams_per_judge, judging.minutes_per_team, judging.parallel_tracks, judging.honorarium_per_judge, judging.constraint_<slug>
   - budget.approved_total, budget.expense_venue, budget.expense_food, budget.expense_printing, budget.expense_prizes, budget.expense_internet, budget.expense_judges, budget.expense_<slug>
   - administrative_deadline.code_freeze, administrative_deadline.<slug>
   - general_constraint.<slug>
   - irrelevant.message
7. Roman Urdu hints: "kam az kam" = minimum, "zyada se zyada" = maximum, "nahi chalega / cancel / mana hai" = prohibition/rejection, "baje" = o'clock, "khaana / boxes / biryani" = food, "hazaar / hazar / k" = thousand, "lakh" = 100,000, "bijli / generator" = power/generator, "namaz / jummah / zuhr / asr" = prayer break, "samjhein / maanein" = consider/treat as.`;

export const EXTRACTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    messages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          messageId: { type: Type.STRING },
          isRelevant: { type: Type.BOOLEAN },
          relevanceReason: { type: Type.STRING },
          senderIdentified: { type: Type.STRING },
          senderRole: { type: Type.STRING },
          authorityLevel: { type: Type.STRING, description: 'high | medium | low | unverified' },
          language: { type: Type.STRING, description: 'en | roman_urdu | mixed' },
          intentSignal: {
            type: Type.STRING,
            description: 'new_info | update | explicit_correction | contradiction | unverified_claim | irrelevant',
          },
          facts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: {
                  type: Type.STRING,
                  description:
                    'attendance | venue | schedule | food | judging | budget | administrative_deadline | general_constraint | irrelevant',
                },
                factKey: { type: Type.STRING },
                summary: { type: Type.STRING },
                valueString: { type: Type.STRING },
                numericValue: { type: Type.NUMBER },
                unit: { type: Type.STRING },
                currency: { type: Type.STRING },
                timeStart: { type: Type.STRING },
                timeEnd: { type: Type.STRING },
                constraintType: { type: Type.STRING, description: 'hard | soft | info | option' },
                isAdministrativeDeadline: { type: Type.BOOLEAN },
                announcedValue: { type: Type.STRING },
                operationalValue: { type: Type.STRING },
                structuredDetailsJson: {
                  type: Type.STRING,
                  description:
                    'Compact JSON object string for multi-field items like venue options {name,capacity,cost,hasGenerator,hasAC,hasWifi,location,restrictions}',
                },
                relatedConstraints: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                confidence: { type: Type.NUMBER },
                rawQuote: { type: Type.STRING },
              },
              required: ['category', 'factKey', 'summary', 'valueString', 'constraintType', 'confidence', 'rawQuote'],
            },
          },
        },
        required: ['messageId', 'isRelevant', 'relevanceReason', 'senderIdentified', 'senderRole', 'authorityLevel', 'language', 'intentSignal', 'facts'],
      },
    },
  },
  required: ['messages'],
};

export function buildExtractionPrompt(messages: ParsedMessage[]): string {
  const compactList = messages.map((m) => ({
    messageId: m.id,
    channel: m.channel,
    sourceType: m.sourceType,
    senderHint: m.sender,
    timestampHint: m.timestamp,
    text: m.rawText,
  }));

  return `Analyze these ${messages.length} message(s) and extract all planning facts, constraints, quantities, costs, times, venue options, and deadlines.\n\nMESSAGES:\n${JSON.stringify(compactList, null, 2)}`;
}

export const CONFLICT_SYSTEM_INSTRUCTION = `You are PlanGUARD's Conflict Resolution Analyst.
Resolve ambiguous pairs of facts using: source authority, explicit corrections, timestamps, hard constraints, and operational clarifications.
NEVER assume the latest message is automatically right if it comes from a lower/unverified authority or violates hard constraints.
Possible classifications: genuine_update, outdated_announcement, contradiction, misleading_statement, irrelevant_message, explicit_correction, new_constraint, unauthorized_instruction, operational_clarification.
Possible winner: "incoming" | "existing" | "human_verification_needed".`;

export const CONFLICT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    resolutions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          pairId: { type: Type.STRING },
          classification: { type: Type.STRING },
          winner: { type: Type.STRING, description: 'incoming | existing | human_verification_needed' },
          reason: { type: Type.STRING },
        },
        required: ['pairId', 'classification', 'winner', 'reason'],
      },
    },
  },
  required: ['resolutions'],
};

export interface AmbiguousConflictPair {
  pairId: string;
  factKey: string;
  existingFact: ExtractedFact;
  incomingFact: ExtractedFact;
}

export function buildConflictPrompt(pairs: AmbiguousConflictPair[]): string {
  const compact = pairs.map((p) => ({
    pairId: p.pairId,
    factKey: p.factKey,
    existing: {
      id: p.existingFact.id,
      value: p.existingFact.value,
      summary: p.existingFact.summary,
      sender: p.existingFact.sender,
      role: p.existingFact.senderRole,
      authority: p.existingFact.authorityAssessment,
      timestamp: p.existingFact.timestamp,
      quote: p.existingFact.rawQuote,
    },
    incoming: {
      id: p.incomingFact.id,
      value: p.incomingFact.value,
      summary: p.incomingFact.summary,
      sender: p.incomingFact.sender,
      role: p.incomingFact.senderRole,
      authority: p.incomingFact.authorityAssessment,
      timestamp: p.incomingFact.timestamp,
      quote: p.incomingFact.rawQuote,
    },
  }));
  return `Resolve each conflict pair conservatively. Flag human_verification_needed if genuinely ambiguous.\n${JSON.stringify(compact, null, 2)}`;
}

export const SCHEDULE_SYNTHESIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    slots: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          durationMinutes: { type: Type.INTEGER },
          type: { type: Type.STRING, description: 'opening | build | prayer_break | judging | closing | logistics | other' },
          notes: { type: Type.STRING },
        },
        required: ['title', 'durationMinutes', 'type', 'notes'],
      },
    },
    rationale: { type: Type.STRING },
  },
  required: ['slots', 'rationale'],
};

export function buildScheduleSynthesisPrompt(params: {
  startTime: string;
  endTime: string;
  targetDurationMinutes: number;
  constraints: string[];
  requiredPrayerBreaks: Array<{ name: string; window: string; durationMinutes: number }>;
  requiredJudgingMinutes: number;
}): string {
  return `Generate a valid sequential timetable totaling EXACTLY ${params.targetDurationMinutes} minutes from ${params.startTime} to ${params.endTime}.
Do NOT include administrative deadlines (like code freeze) as physical schedule blocks if they are external submission cutoffs.
Required Prayer Breaks: ${JSON.stringify(params.requiredPrayerBreaks)}
Minimum Judging Duration Needed: ${params.requiredJudgingMinutes} minutes.
Additional Timing Constraints: ${JSON.stringify(params.constraints)}
Ensure sum of durationMinutes equals ${params.targetDurationMinutes} with zero overlaps.`;
}
