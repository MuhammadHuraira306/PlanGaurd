import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunCallBudget } from '../src/ai/modelWrapper.ts';
import { planBudget } from '../src/planners/budgetPlanner.ts';
import { planFood } from '../src/planners/foodPlanner.ts';
import { planJudging } from '../src/planners/judgingPlanner.ts';
import { planSchedule } from '../src/planners/schedulePlanner.ts';
import { planVenue } from '../src/planners/venuePlanner.ts';
import { resolveAndMergeFacts } from '../src/processing/conflictResolver.ts';
import { readRawTextInput } from '../src/processing/fileReader.ts';
import { parseMessagePack } from '../src/processing/messageParser.ts';
import { predictAffectedAreas } from '../src/updates/dependencyEngine.ts';
import { validateEventPlan } from '../src/validation/planValidator.ts';
import type { ExtractedFact, ModelConfig } from '../src/types/planguard.ts';

function makeFact(partial: Partial<ExtractedFact> & Pick<ExtractedFact, 'id' | 'category' | 'factKey' | 'summary' | 'value'>): ExtractedFact {
  return {
    numericValue: typeof partial.value === 'number' ? partial.value : null,
    unit: null,
    currency: null,
    timeRange: null,
    constraintType: 'hard',
    isAdministrativeDeadline: false,
    announcedValue: null,
    operationalValue: null,
    originalMessageId: 'MSG-001',
    sender: 'Lead Organizer',
    senderRole: 'Event Director',
    timestamp: '2026-11-17T10:00:00Z',
    confidence: 0.95,
    authorityAssessment: 'high',
    status: 'Confirmed',
    relatedConstraints: [],
    reason: 'Authoritative specification',
    rawQuote: partial.summary,
    history: [],
    ...partial,
  };
}

async function runAllTests() {
  console.log('Running PlanGUARD deterministic & generalization test suite...\n');

  // Test 1: Generic Multi-Format Message Parser
  const mixedPack = `From: Director <dir@event.pk>
Date: Nov 17, 2026 09:00 AM
We have 120 students in 40 teams. Budget is PKR 180,000.

[09:30 AM, 11/17/2026] Ops Team: Generator zaroori hai, warna event nahi hoga.

3. Notice: Code freeze is at 2:00 PM. Please consider it as 1:50 PM.`;

  const readRes = readRawTextInput(mixedPack, 'unseen_test.txt');
  const parsed = parseMessagePack({
    normalizedText: readRes.normalizedContent,
    sourceFile: readRes.filename,
  });
  assert.equal(parsed.length, 3, 'Should parse blank-line separated email, WhatsApp, and notice blocks');
  assert.equal(parsed[0].channel, 'email');
  assert.equal(parsed[1].channel, 'whatsapp');
  assert.equal(parsed[1].sender, 'Ops Team');
  const sampleText = readFileSync(new URL('../data/samples/mtm_brief_sample.txt', import.meta.url), 'utf8');
  const sampleMessages = parseMessagePack({
    normalizedText: readRawTextInput(sampleText, 'mtm_brief_sample.txt').normalizedContent,
    sourceFile: 'mtm_brief_sample.txt',
  });
  assert.equal(sampleMessages.length, 8, 'The supplied brief sample must parse into all eight messages');
  console.log('PASS [1/7] Generic parser and supplied brief sample');

  // Test 2: Venue Selection (Never blindly pick cheapest non-compliant venue)
  const baseFacts: ExtractedFact[] = [
    makeFact({ id: 'F1', category: 'attendance', factKey: 'attendance.students', summary: '150 students', value: 150 }),
    makeFact({ id: 'F2', category: 'attendance', factKey: 'attendance.teams', summary: '50 teams', value: 50 }),
    makeFact({ id: 'F3', category: 'attendance', factKey: 'attendance.organizers', summary: '12 organizers', value: 12 }),
    makeFact({ id: 'F4', category: 'attendance', factKey: 'attendance.guests', summary: '10 volunteers', value: 10 }),
    makeFact({ id: 'F5', category: 'judging', factKey: 'judging.available_judges', summary: '5 judges', value: 5 }),
    makeFact({ id: 'F6', category: 'judging', factKey: 'judging.max_teams_per_judge', summary: 'Max 10 teams/judge', value: 10 }),
    makeFact({ id: 'F7', category: 'judging', factKey: 'judging.minutes_per_team', summary: '5 min/team', value: 5 }),
    makeFact({ id: 'F8', category: 'judging', factKey: 'judging.honorarium_per_judge', summary: 'Rs 4000/judge', value: 4000 }),
    makeFact({ id: 'F9', category: 'venue', factKey: 'venue.requirement_generator', summary: 'Backup generator mandatory', value: true }),
    makeFact({
      id: 'F10',
      category: 'venue',
      factKey: 'venue.option_cheapest',
      summary: 'Small Room',
      constraintType: 'option',
      value: { name: 'Small Room', capacity: 140, cost: 30000, hasGenerator: false, hasAC: true, hasWifi: true, location: 'Islamabad' },
    }),
    makeFact({
      id: 'F11',
      category: 'venue',
      factKey: 'venue.option_compliant',
      summary: 'Main Auditorium',
      constraintType: 'option',
      value: { name: 'Main Auditorium', capacity: 220, cost: 55000, hasGenerator: true, hasAC: true, hasWifi: true, location: 'Islamabad' },
    }),
    makeFact({ id: 'F12', category: 'food', factKey: 'food.unit_price', summary: 'Rs 650 per box', value: 650 }),
    makeFact({ id: 'F13', category: 'food', factKey: 'food.delivery_charge', summary: 'Rs 2500 delivery', value: 2500 }),
    makeFact({ id: 'F14', category: 'budget', factKey: 'budget.approved_total', summary: 'PKR 250,000', value: 250000, currency: 'PKR' }),
    makeFact({ id: 'F15', category: 'budget', factKey: 'budget.expense_prizes', summary: 'Prizes Rs 50,000', value: 50000 }),
    makeFact({ id: 'F16', category: 'budget', factKey: 'budget.expense_printing', summary: 'Printing Rs 10,000', value: 10000 }),
    makeFact({ id: 'F17', category: 'budget', factKey: 'budget.expense_internet', summary: 'Internet Rs 8,000', value: 8000 }),
    makeFact({ id: 'F18', category: 'schedule', factKey: 'schedule.event_window', summary: '10:00 AM to 2:00 PM', value: '10:00 AM - 2:00 PM', timeRange: { start: '10:00 AM', end: '2:00 PM' } }),
    makeFact({ id: 'F19', category: 'schedule', factKey: 'schedule.prayer_break_zuhr', summary: '20 min Zuhr break', value: '20 min' }),
    makeFact({
      id: 'F20',
      category: 'administrative_deadline',
      factKey: 'administrative_deadline.code_freeze',
      summary: 'Code freeze 1:25 PM superseded by 1:50 PM operational',
      value: '1:50 PM',
      isAdministrativeDeadline: true,
      announcedValue: '2:00 PM',
      operationalValue: '1:50 PM',
    }),
  ];

  const venuePlan = planVenue(baseFacts);
  assert.equal(venuePlan.requiredCapacity, 177, '150 students + 5 judges + 12 org + 10 vol = 177');
  assert.equal(venuePlan.selectedVenue, 'Main Auditorium', 'Should reject cheaper non-generator venue');
  console.log('PASS [2/7] Venue planner enforces capacity & generator constraints');

  // Test 3: Food, Judging, Schedule, Budget & Validation
  const judgingPlan = planJudging(baseFacts);
  assert.equal(judgingPlan.totalJudgingCapacity, 50);
  assert.equal(judgingPlan.requiredMinutesPerJudge, 50);

  const foodPlan = planFood(baseFacts);
  assert.equal(foodPlan.peopleRequiringFood, 177);
  assert.equal(foodPlan.orderedQuantity, 177, 'Must never confuse 50 teams with 177 people');
  assert.equal(foodPlan.totalFoodCost, 177 * 650 + 2500);

  const dummyModelConfig: ModelConfig = { provider: 'gemini', modelName: 'gemini-3.1-flash-lite' };
  const budget = createRunCallBudget('initial', 5);
  const schedulePlan = await planSchedule({
    allFacts: baseFacts,
    requiredJudgingMinutes: judgingPlan.requiredMinutesPerJudge,
    modelConfig: dummyModelConfig,
    budget,
    useAiIfComplex: false,
  });
  assert.equal(schedulePlan.actualDurationMinutes, 240, '4-hour schedule must equal 240 minutes');
  assert.equal(schedulePlan.administrativeDeadlines[0].operationalTime, '1:50 PM');
  assert.equal(
    schedulePlan.slots.some((s) => s.title.toLowerCase().includes('code freeze')),
    false,
    'Administrative code freeze must not pollute 4-hour physical schedule slots',
  );

  const budgetPlan = planBudget({ facts: baseFacts, venue: venuePlan, food: foodPlan, judging: judgingPlan });
  // 55,000 + 117,550 + 20,000 + 50,000 + 10,000 + 8,000 = 260,550 (Wait: 260,550 > 250,000 -> validator MUST flag IMPOSSIBLE!)
  const valOver = validateEventPlan(
    { version: 1, generatedAt: '', lastUpdatedAt: '', venue: venuePlan, schedule: schedulePlan, food: foodPlan, judging: judgingPlan, budget: budgetPlan },
    baseFacts,
  );
  assert.equal(valOver.isValid, false, 'Validator must never mark an over-budget plan as valid');
  assert.equal(valOver.overallStatus, 'IMPOSSIBLE', 'Should flag over-budget plan as IMPOSSIBLE');
  console.log('PASS [3/7] Food, Judging, Schedule (admin deadline separation), Budget & Impossible Budget Detection');

  // Test 4: Practice Message 1 (Genuine printing update Rs 10,000 -> Rs 15,000) & Dependency Prediction
  const withHigherBudget = baseFacts.map((f) =>
    f.factKey === 'budget.approved_total' ? { ...f, value: 300000, numericValue: 300000 } : f,
  );
  const printingUpdateFact = makeFact({
    id: 'F-PRINT-NEW',
    category: 'budget',
    factKey: 'budget.expense_printing',
    summary: 'Printing bill updated to Rs 15,000',
    value: 15000,
    numericValue: 15000,
    sender: 'Finance',
    senderRole: 'Finance Lead',
    authorityAssessment: 'high',
    originalMessageId: 'MSG-P1',
    timestamp: '2026-11-17T12:00:00Z',
  });

  const mergedPrint = await resolveAndMergeFacts({
    existingFacts: withHigherBudget,
    incomingFacts: [printingUpdateFact],
    messages: [],
    intentByMessageId: { 'MSG-P1': 'explicit_correction' },
    modelConfig: dummyModelConfig,
    budget: createRunCallBudget('incremental', 5),
  });
  const activePrint = mergedPrint.facts.find((f) => f.factKey === 'budget.expense_printing' && f.status === 'Confirmed');
  const oldPrint = mergedPrint.facts.find((f) => f.id === 'F16');
  assert.equal(activePrint?.numericValue, 15000);
  assert.equal(oldPrint?.status, 'Superseded');
  const depPrint = predictAffectedAreas(mergedPrint.changedFactKeys);
  assert.deepEqual(depPrint.affectedAreas, ['budget'], 'Printing expense change must ONLY affect budget');
  console.log('PASS [4/7] Practice Message 1: Printing update supersedes Rs 10,000 and targets only budget');

  // Test 5: Practice Message 2 (Plausible-sounding caterer reduction to 100 boxes when 177 needed -> REJECTED)
  const catererTrapFact = makeFact({
    id: 'F-FOOD-TRAP',
    category: 'food',
    factKey: 'food.order_quantity',
    summary: 'Rounded food order down to 100 boxes',
    value: 100,
    numericValue: 100,
    sender: 'Caterer',
    senderRole: 'Vendor',
    authorityAssessment: 'medium',
    originalMessageId: 'MSG-P2',
    timestamp: '2026-11-17T13:00:00Z',
  });

  const mergedTrap = await resolveAndMergeFacts({
    existingFacts: mergedPrint.facts,
    incomingFacts: [catererTrapFact],
    messages: [],
    intentByMessageId: { 'MSG-P2': 'update' },
    modelConfig: dummyModelConfig,
    budget: createRunCallBudget('incremental', 5),
  });
  const trapResult = mergedTrap.facts.find((f) => f.id === 'F-FOOD-TRAP');
  assert.equal(trapResult?.status, 'Rejected', '100 boxes must be REJECTED when 177 attendees require food');
  const depTrap = predictAffectedAreas(mergedTrap.changedFactKeys);
  assert.deepEqual(depTrap.affectedAreas, [], 'Rejected message must trigger 0 planning area updates');
  console.log('PASS [5/7] Practice Message 2: Insufficient 100-box catering reduction rejected & plan preserved');

  // Test 6: Valid Plan with Unseen Synthetic Numbers (120 students, 40 teams, 4 judges)
  const unseenFacts: ExtractedFact[] = [
    makeFact({ id: 'U1', category: 'attendance', factKey: 'attendance.students', summary: '120 students', value: 120 }),
    makeFact({ id: 'U2', category: 'attendance', factKey: 'attendance.teams', summary: '40 teams', value: 40 }),
    makeFact({ id: 'U3', category: 'attendance', factKey: 'attendance.organizers', summary: '8 organizers', value: 8 }),
    makeFact({ id: 'U4', category: 'attendance', factKey: 'attendance.guests', summary: '6 guests', value: 6 }),
    makeFact({ id: 'U5', category: 'judging', factKey: 'judging.available_judges', summary: '4 judges', value: 4 }),
    makeFact({ id: 'U6', category: 'judging', factKey: 'judging.max_teams_per_judge', summary: 'Max 12 teams/judge', value: 12 }),
    makeFact({ id: 'U7', category: 'judging', factKey: 'judging.minutes_per_team', summary: '4 min/team', value: 4 }),
    makeFact({ id: 'U8', category: 'judging', factKey: 'judging.honorarium_per_judge', summary: 'Rs 3500/judge', value: 3500 }),
    makeFact({
      id: 'U9',
      category: 'venue',
      factKey: 'venue.option_serenity',
      summary: 'Serenity Pavilion',
      constraintType: 'option',
      value: { name: 'Serenity Pavilion', capacity: 160, cost: 40000, hasGenerator: true, hasAC: true, hasWifi: true, location: 'Islamabad' },
    }),
    makeFact({ id: 'U10', category: 'food', factKey: 'food.unit_price', summary: 'Rs 550', value: 550 }),
    makeFact({ id: 'U11', category: 'food', factKey: 'food.delivery_charge', summary: 'Rs 2000', value: 2000 }),
    makeFact({ id: 'U12', category: 'budget', factKey: 'budget.approved_total', summary: 'PKR 195,000', value: 195000, currency: 'PKR' }),
    makeFact({ id: 'U13', category: 'budget', factKey: 'budget.expense_prizes', summary: 'Prizes Rs 45,000', value: 45000 }),
    makeFact({ id: 'U14', category: 'budget', factKey: 'budget.expense_printing', summary: 'Printing Rs 7,500', value: 7500 }),
    makeFact({ id: 'U15', category: 'budget', factKey: 'budget.expense_internet', summary: 'Internet Rs 6,500', value: 6500 }),
    makeFact({ id: 'U16', category: 'schedule', factKey: 'schedule.event_window', summary: '1:00 PM - 5:00 PM', value: '1:00 PM - 5:00 PM', timeRange: { start: '1:00 PM', end: '5:00 PM' } }),
    makeFact({ id: 'U17', category: 'schedule', factKey: 'schedule.prayer_break_asr', summary: '15 min Asr break', value: '15 min' }),
  ];

  const uv = planVenue(unseenFacts);
  const uj = planJudging(unseenFacts);
  const uf = planFood(unseenFacts);
  const us = await planSchedule({
    allFacts: unseenFacts,
    requiredJudgingMinutes: uj.requiredMinutesPerJudge,
    modelConfig: dummyModelConfig,
    budget: createRunCallBudget('initial', 5),
    useAiIfComplex: false,
  });
  const ub = planBudget({ facts: unseenFacts, venue: uv, food: uf, judging: uj });
  const uVal = validateEventPlan(
    { version: 1, generatedAt: '', lastUpdatedAt: '', venue: uv, schedule: us, food: uf, judging: uj, budget: ub },
    unseenFacts,
  );
  assert.equal(uVal.overallStatus, 'VALID', `Expected VALID plan on unseen dataset, got: ${JSON.stringify(uVal.failedChecks)}`);
  console.log('PASS [6/7] Full unseen synthetic pack validated as VALID');

  const withUnknownHardConstraint = [
    ...unseenFacts,
    makeFact({
      id: 'U18',
      category: 'general_constraint',
      factKey: 'general_constraint.step_free_access',
      summary: 'The venue must be step-free',
      value: true,
    }),
  ];
  const unresolvedPlan = validateEventPlan(
    { version: 1, generatedAt: '', lastUpdatedAt: '', venue: uv, schedule: us, food: uf, judging: uj, budget: ub },
    withUnknownHardConstraint,
  );
  assert.equal(unresolvedPlan.overallStatus, 'INCOMPLETE');
  assert.equal(
    unresolvedPlan.unresolvedConstraints.some((check) => check.checkName.includes('step_free_access')),
    true,
    'Unknown hard constraints must not be silently treated as satisfied',
  );
  console.log('PASS [7/7] Unknown hard constraints block a false VALID result');
  console.log('\nAll 7 PlanGUARD verification suites passed.');
}

runAllTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
