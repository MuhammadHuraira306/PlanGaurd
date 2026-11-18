import { createRunCallBudget } from '../ai/modelWrapper.ts';
import { planBudget } from '../planners/budgetPlanner.ts';
import { planFood } from '../planners/foodPlanner.ts';
import { planJudging } from '../planners/judgingPlanner.ts';
import { planSchedule } from '../planners/schedulePlanner.ts';
import { planVenue } from '../planners/venuePlanner.ts';
import { resolveAndMergeFacts } from '../processing/conflictResolver.ts';
import { transitionFactStatus } from '../processing/contextManager.ts';
import { extractFactsFromMessages } from '../processing/factExtractor.ts';
import { readRawTextInput } from '../processing/fileReader.ts';
import { parseMessagePack } from '../processing/messageParser.ts';
import { loadWorkspace, resetAllData, saveWorkspace } from '../storage/dataStore.ts';
import type {
  EventPlan,
  ImpactRecord,
  MessageSourceType,
  PlanningArea,
  WorkspaceState,
} from '../types/planguard.ts';
import { validateEventPlan } from '../validation/planValidator.ts';
import { predictAffectedAreas } from './dependencyEngine.ts';

function computePlanDiffs(prev: EventPlan | null, next: EventPlan): ImpactRecord['fieldDiffs'] {
  if (!prev) return [];
  const diffs: ImpactRecord['fieldDiffs'] = [];

  if (prev.venue.selectedVenue !== next.venue.selectedVenue) {
    diffs.push({
      area: 'venue',
      field: 'selectedVenue',
      previousValue: prev.venue.selectedVenue || 'None',
      newValue: next.venue.selectedVenue || 'None',
      reason: next.venue.rationale,
    });
  }
  if (prev.venue.requiredCapacity !== next.venue.requiredCapacity) {
    diffs.push({
      area: 'venue',
      field: 'requiredCapacity',
      previousValue: String(prev.venue.requiredCapacity),
      newValue: String(next.venue.requiredCapacity),
      reason: 'Attendance change updated venue capacity requirement',
    });
  }
  if (prev.food.orderedQuantity !== next.food.orderedQuantity || prev.food.totalFoodCost !== next.food.totalFoodCost) {
    diffs.push({
      area: 'food',
      field: 'totalFoodCost',
      previousValue: `${prev.food.orderedQuantity} units (${prev.food.totalFoodCost})`,
      newValue: `${next.food.orderedQuantity} units (${next.food.totalFoodCost})`,
      reason: next.food.rationale,
    });
  }
  if (
    prev.judging.availableJudges !== next.judging.availableJudges ||
    prev.judging.requiredMinutesPerJudge !== next.judging.requiredMinutesPerJudge
  ) {
    diffs.push({
      area: 'judging',
      field: 'judgingCapacity',
      previousValue: `${prev.judging.availableJudges} judges (${prev.judging.requiredMinutesPerJudge}m/judge)`,
      newValue: `${next.judging.availableJudges} judges (${next.judging.requiredMinutesPerJudge}m/judge)`,
      reason: next.judging.rationale,
    });
  }
  if (prev.schedule.administrativeDeadlines.length !== next.schedule.administrativeDeadlines.length ||
      JSON.stringify(prev.schedule.administrativeDeadlines) !== JSON.stringify(next.schedule.administrativeDeadlines)) {
    diffs.push({
      area: 'schedule',
      field: 'administrativeDeadlines',
      previousValue: prev.schedule.administrativeDeadlines.map((d) => `${d.name}: ${d.operationalTime}`).join(', ') || 'None',
      newValue: next.schedule.administrativeDeadlines.map((d) => `${d.name}: ${d.operationalTime}`).join(', ') || 'None',
      reason: 'Updated administrative deadline without altering 4-hour physical schedule',
    });
  }
  if (prev.budget.totalExpenses !== next.budget.totalExpenses || prev.budget.remainingBudget !== next.budget.remainingBudget) {
    diffs.push({
      area: 'budget',
      field: 'totalExpenses / remainingBudget',
      previousValue: `${prev.budget.totalExpenses} spent / ${prev.budget.remainingBudget} left`,
      newValue: `${next.budget.totalExpenses} spent / ${next.budget.remainingBudget} left`,
      reason: next.budget.rationale,
    });
  }

  return diffs;
}

export async function runInitialMessagePack(params: {
  rawText: string;
  filename: string;
}): Promise<WorkspaceState> {
  const startedAt = Date.now();
  const currentState = loadWorkspace();
  const state = resetAllData(currentState.modelConfig);

  const fileInfo = readRawTextInput(params.rawText, params.filename);
  const parsedMessages = parseMessagePack({
    normalizedText: fileInfo.normalizedContent,
    sourceFile: fileInfo.filename,
    startingIndex: 1,
    sourceType: 'message_pack',
  });

  const budget = createRunCallBudget('initial', 8);

  const extraction = await extractFactsFromMessages({
    messages: parsedMessages,
    modelConfig: state.modelConfig,
    budget,
    existingFactCount: 0,
  });

  const merged = await resolveAndMergeFacts({
    existingFacts: [],
    incomingFacts: extraction.extractedFacts,
    messages: parsedMessages,
    intentByMessageId: extraction.intentByMessageId,
    modelConfig: state.modelConfig,
    budget,
  });

  const venue = planVenue(merged.facts, null);
  const judging = planJudging(merged.facts, null);
  const food = planFood(merged.facts, null);
  const schedule = await planSchedule({
    allFacts: merged.facts,
    requiredJudgingMinutes: judging.requiredMinutesPerJudge,
    modelConfig: state.modelConfig,
    budget,
    useAiIfComplex: true,
    previousPlan: null,
  });
  const budgetPlan = planBudget({
    facts: merged.facts,
    venue,
    food,
    judging,
    previousPlan: null,
  });

  const now = new Date().toISOString();
  const plan: EventPlan = {
    version: 1,
    generatedAt: now,
    lastUpdatedAt: now,
    venue,
    schedule,
    food,
    judging,
    budget: budgetPlan,
  };

  const validation = validateEventPlan(plan, merged.facts);
  const executionMs = Date.now() - startedAt;

  const impact: ImpactRecord = {
    id: `IMP-${Date.now()}`,
    timestamp: now,
    triggerType: 'initial_pack',
    messageId: null,
    messagePreview: `${parsedMessages.length} messages ingested from ${fileInfo.filename}`,
    changedFactKeys: merged.changedFactKeys,
    affectedAreas: ['venue', 'schedule', 'food', 'judging', 'budget'],
    unaffectedAreas: [],
    aiCallsMade: budget.callsUsed,
    modelNamesUsed: Array.from(budget.modelsUsed),
    executionMs,
    fieldDiffs: [],
    summary: `Initial full-pack processing completed in ${executionMs}ms using ${budget.callsUsed} model call(s). Plan status: ${validation.overallStatus}.`,
  };

  state.sourceFileName = fileInfo.filename;
  state.lastRunAt = now;
  state.lastExecutionMs = executionMs;
  state.messages = parsedMessages;
  state.facts = merged.facts;
  state.conflicts = merged.conflicts;
  state.plan = plan;
  state.validation = validation;
  state.impacts = [impact];

  saveWorkspace(state);
  return state;
}

export async function processIncrementalMessage(params: {
  rawText: string;
  senderOverride?: string;
  sourceType?: MessageSourceType;
}): Promise<{ state: WorkspaceState; impact: ImpactRecord }> {
  const startedAt = Date.now();
  const state = loadWorkspace();

  if (!state.plan) {
    // If no initial pack exists yet, initialize cleanly via single-message pack
    const initialized = await runInitialMessagePack({
      rawText: params.rawText,
      filename: 'direct_message.txt',
    });
    return {
      state: initialized,
      impact: initialized.impacts[initialized.impacts.length - 1],
    };
  }

  const fileInfo = readRawTextInput(params.rawText, 'incremental_message.txt');
  const nextIndex = state.messages.length + 1;
  const newMsgs = parseMessagePack({
    normalizedText: fileInfo.normalizedContent,
    sourceFile: params.sourceType === 'external_authoritative_clarification' ? 'external_clarification' : 'incremental_input',
    startingIndex: nextIndex,
    sourceType: params.sourceType || 'incremental_message',
    senderOverride: params.senderOverride,
  });

  // Strict incremental limit: <= 5 model calls
  const budget = createRunCallBudget('incremental', 5);

  const extraction = await extractFactsFromMessages({
    messages: newMsgs,
    modelConfig: state.modelConfig,
    budget,
    existingFactCount: state.facts.length,
  });

  const allMessages = [...state.messages, ...newMsgs];
  const merged = await resolveAndMergeFacts({
    existingFacts: state.facts,
    incomingFacts: extraction.extractedFacts,
    messages: allMessages,
    intentByMessageId: extraction.intentByMessageId,
    modelConfig: state.modelConfig,
    budget,
  });

  const prediction = predictAffectedAreas(merged.changedFactKeys);
  const affectedSet = new Set<PlanningArea>(prediction.affectedAreas);
  const prevPlan = state.plan;

  // ONLY recalculate affected areas! Preserve unaffected areas verbatim (with cleared updatedFields).
  const venue = affectedSet.has('venue')
    ? planVenue(merged.facts, prevPlan.venue)
    : { ...prevPlan.venue, updatedFields: [] };

  const judging = affectedSet.has('judging')
    ? planJudging(merged.facts, prevPlan.judging)
    : { ...prevPlan.judging, updatedFields: [] };

  const food = affectedSet.has('food')
    ? planFood(merged.facts, prevPlan.food)
    : { ...prevPlan.food, updatedFields: [] };

  const onlyAdminDeadlineChanged =
    merged.changedFactKeys.length > 0 &&
    merged.changedFactKeys.every((k) => k.startsWith('administrative_deadline.'));

  const schedule = affectedSet.has('schedule')
    ? await planSchedule({
        allFacts: merged.facts,
        requiredJudgingMinutes: judging.requiredMinutesPerJudge,
        modelConfig: state.modelConfig,
        budget,
        useAiIfComplex: !onlyAdminDeadlineChanged,
        previousPlan: prevPlan.schedule,
      })
    : { ...prevPlan.schedule, updatedFields: [] };

  const budgetPlan =
    affectedSet.has('budget') || affectedSet.has('venue') || affectedSet.has('food') || affectedSet.has('judging')
      ? planBudget({
          facts: merged.facts,
          venue,
          food,
          judging,
          previousPlan: prevPlan.budget,
        })
      : { ...prevPlan.budget, updatedFields: [] };

  const now = new Date().toISOString();
  const nextPlan: EventPlan = {
    version: prevPlan.version + 1,
    generatedAt: prevPlan.generatedAt,
    lastUpdatedAt: now,
    venue,
    schedule,
    food,
    judging,
    budget: budgetPlan,
  };

  const validation = validateEventPlan(nextPlan, merged.facts);
  const executionMs = Date.now() - startedAt;
  const fieldDiffs = computePlanDiffs(prevPlan, nextPlan);

  const impact: ImpactRecord = {
    id: `IMP-${Date.now()}`,
    timestamp: now,
    triggerType: 'incremental_message',
    messageId: newMsgs[0].id,
    messagePreview: newMsgs[0].rawText.slice(0, 140),
    changedFactKeys: merged.changedFactKeys,
    affectedAreas: prediction.affectedAreas,
    unaffectedAreas: prediction.unaffectedAreas,
    aiCallsMade: budget.callsUsed,
    modelNamesUsed: Array.from(budget.modelsUsed),
    executionMs,
    fieldDiffs,
    summary:
      merged.changedFactKeys.length === 0
        ? `Message ${newMsgs[0].id} did not alter the active plan (${newMsgs[0].processingStatus}). 0 planning areas regenerated (${budget.callsUsed} reading call, ${executionMs}ms).`
        : `Updated [${prediction.affectedAreas.join(', ')}] while preserving [${prediction.unaffectedAreas.join(', ')}] in ${executionMs}ms using ${budget.callsUsed} model call(s).`,
  };

  state.lastRunAt = now;
  state.lastExecutionMs = executionMs;
  state.messages = allMessages;
  state.facts = merged.facts;
  state.conflicts = [...state.conflicts, ...merged.conflicts];
  state.plan = nextPlan;
  state.validation = validation;
  state.impacts = [...state.impacts, impact];

  saveWorkspace(state);
  return { state, impact };
}

export async function resolveFactManually(params: {
  factId: string;
  decision: 'confirm' | 'reject';
  note?: string;
}): Promise<WorkspaceState> {
  const startedAt = Date.now();
  const state = loadWorkspace();
  const fact = state.facts.find((f) => f.id === params.factId);
  if (!fact) {
    throw new Error(`Fact not found: ${params.factId}`);
  }

  const reason =
    params.note?.trim() ||
    (params.decision === 'confirm'
      ? 'Manually confirmed by human organizer review'
      : 'Manually rejected by human organizer review');

  if (params.decision === 'confirm') {
    // Supersede any existing active fact on same factKey
    for (const other of state.facts) {
      if (other.id !== fact.id && other.factKey === fact.factKey && (other.status === 'Confirmed' || other.status === 'Accepted')) {
        other.supersededByFactId = fact.id;
        transitionFactStatus(other, 'Superseded', `Superseded via human verification of ${fact.id}`, fact.originalMessageId);
      }
    }
    transitionFactStatus(fact, 'Confirmed', reason, fact.originalMessageId);
  } else {
    transitionFactStatus(fact, 'Rejected', reason, fact.originalMessageId);
  }

  for (const c of state.conflicts) {
    if (c.incomingFactId === fact.id || c.originalFactId === fact.id) {
      c.requiresHumanVerification = false;
      c.finalStatus = fact.status;
      c.reason = `${c.reason} | Human review: ${reason}`;
    }
  }

  if (state.plan) {
    const prediction = predictAffectedAreas(params.decision === 'confirm' ? [fact.factKey] : []);
    const affectedSet = new Set<PlanningArea>(prediction.affectedAreas);
    const prevPlan = state.plan;

    const venue = affectedSet.has('venue') ? planVenue(state.facts, prevPlan.venue) : prevPlan.venue;
    const judging = affectedSet.has('judging') ? planJudging(state.facts, prevPlan.judging) : prevPlan.judging;
    const food = affectedSet.has('food') ? planFood(state.facts, prevPlan.food) : prevPlan.food;
    const budget = createRunCallBudget('resolution', 2);
    const schedule = affectedSet.has('schedule')
      ? await planSchedule({
          allFacts: state.facts,
          requiredJudgingMinutes: judging.requiredMinutesPerJudge,
          modelConfig: state.modelConfig,
          budget,
          useAiIfComplex: false,
          previousPlan: prevPlan.schedule,
        })
      : prevPlan.schedule;
    const budgetPlan =
      affectedSet.has('budget') || affectedSet.has('venue') || affectedSet.has('food') || affectedSet.has('judging')
        ? planBudget({ facts: state.facts, venue, food, judging, previousPlan: prevPlan.budget })
        : prevPlan.budget;

    const now = new Date().toISOString();
    const nextPlan: EventPlan = {
      version: prevPlan.version + 1,
      generatedAt: prevPlan.generatedAt,
      lastUpdatedAt: now,
      venue,
      schedule,
      food,
      judging,
      budget: budgetPlan,
    };
    state.plan = nextPlan;
    state.validation = validateEventPlan(nextPlan, state.facts);
    state.impacts.push({
      id: `IMP-${Date.now()}`,
      timestamp: now,
      triggerType: 'human_resolution',
      messageId: fact.originalMessageId,
      messagePreview: `Human verification on ${fact.factKey}: ${params.decision.toUpperCase()}`,
      changedFactKeys: params.decision === 'confirm' ? [fact.factKey] : [],
      affectedAreas: prediction.affectedAreas,
      unaffectedAreas: prediction.unaffectedAreas,
      aiCallsMade: 0,
      modelNamesUsed: [],
      executionMs: Date.now() - startedAt,
      fieldDiffs: computePlanDiffs(prevPlan, nextPlan),
      summary: `Human review marked ${fact.id} as ${fact.status} with 0 AI calls.`,
    });
  }

  saveWorkspace(state);
  return state;
}
