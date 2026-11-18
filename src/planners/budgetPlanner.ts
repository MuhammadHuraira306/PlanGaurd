import { extractNumericFromFact, getActiveFacts } from '../processing/contextManager.ts';
import type {
  BudgetLineItem,
  BudgetPlan,
  ExtractedFact,
  FoodPlan,
  JudgingPlan,
  VenuePlan,
} from '../types/planguard.ts';

function mapFactKeyToBudgetCategory(key: string): BudgetLineItem['category'] {
  if (key.includes('venue')) return 'venue';
  if (key.includes('food') || key.includes('cater')) return 'food';
  if (key.includes('judge')) return 'judges';
  if (key.includes('prize') || key.includes('award')) return 'prizes';
  if (key.includes('print') || key.includes('banner') || key.includes('swag')) return 'printing';
  if (key.includes('internet') || key.includes('wifi')) return 'internet';
  return 'other';
}

function normalizeLabel(key: string): string {
  return key
    .replace(/^budget\.expense_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function planBudget(params: {
  facts: ExtractedFact[];
  venue: VenuePlan;
  food: FoodPlan;
  judging: JudgingPlan;
  previousPlan?: BudgetPlan | null;
}): BudgetPlan {
  const activeBudget = getActiveFacts(params.facts, 'budget');
  const budgetTotalFact = activeBudget.find((f) => f.factKey === 'budget.approved_total');
  const approvedBudget = budgetTotalFact ? extractNumericFromFact(budgetTotalFact) ?? 0 : 0;
  const currency = budgetTotalFact?.currency || 'PKR';

  const lineItems: BudgetLineItem[] = [];
  const coveredCategories = new Set<string>();

  // 1. Venue cost (from VenuePlan if selected, else from budget.expense_venue)
  if (params.venue.venueCost > 0) {
    lineItems.push({
      id: 'BUD-VENUE',
      category: 'venue',
      label: `Venue (${params.venue.selectedVenue || 'Selected Venue'})`,
      amount: params.venue.venueCost,
      committed: true,
      sourceFactId: 'VENUE_PLAN',
      sourceMessageId: 'DERIVED',
      notes: 'Selected compliant venue rent',
    });
    coveredCategories.add('venue');
  }

  // 2. Food cost (from FoodPlan)
  if (params.food.totalFoodCost > 0) {
    lineItems.push({
      id: 'BUD-FOOD',
      category: 'food',
      label: `Food & Delivery (${params.food.orderedQuantity} × ${params.food.unitPrice} + ${params.food.deliveryCharge})`,
      amount: params.food.totalFoodCost,
      committed: true,
      sourceFactId: 'FOOD_PLAN',
      sourceMessageId: 'DERIVED',
      notes: `Covers ${params.food.peopleRequiringFood} attendees`,
    });
    coveredCategories.add('food');
  }

  // 3. Judge honorariums (from JudgingPlan)
  if (params.judging.totalJudgeHonorarium > 0) {
    lineItems.push({
      id: 'BUD-JUDGES',
      category: 'judges',
      label: `Judge Honorariums (${params.judging.availableJudges} judges)`,
      amount: params.judging.totalJudgeHonorarium,
      committed: true,
      sourceFactId: 'JUDGING_PLAN',
      sourceMessageId: 'DERIVED',
      notes: 'Calculated from active judge count & honorarium',
    });
    coveredCategories.add('judges');
  }

  // 4. All other explicit active budget expenses (deduplicated by factKey)
  const seenFactKeys = new Set<string>();
  for (const f of activeBudget) {
    if (f.factKey === 'budget.approved_total') continue;
    if (seenFactKeys.has(f.factKey)) continue;
    seenFactKeys.add(f.factKey);

    const cat = mapFactKeyToBudgetCategory(f.factKey);
    // Prevent double-counting venue, food, or judges already derived above
    if ((cat === 'venue' && coveredCategories.has('venue')) ||
        (cat === 'food' && coveredCategories.has('food')) ||
        (cat === 'judges' && coveredCategories.has('judges'))) {
      continue;
    }

    const amt = extractNumericFromFact(f);
    if (amt === null || amt < 0) continue;

    lineItems.push({
      id: `BUD-${f.id}`,
      category: cat,
      label: normalizeLabel(f.factKey),
      amount: amt,
      committed: true,
      sourceFactId: f.id,
      sourceMessageId: f.originalMessageId,
      notes: f.summary,
    });
  }

  // Track superseded budget expenses for full transparency
  const supersededExpenses: BudgetPlan['supersededExpenses'] = [];
  for (const f of params.facts) {
    if (f.category === 'budget' && f.status === 'Superseded' && f.supersededByFactId) {
      const replacement = params.facts.find((x) => x.id === f.supersededByFactId);
      const oldAmt = extractNumericFromFact(f) ?? 0;
      const newAmt = replacement ? extractNumericFromFact(replacement) ?? 0 : 0;
      supersededExpenses.push({
        label: normalizeLabel(f.factKey),
        oldAmount: oldAmt,
        newAmount: newAmt,
        reason: replacement?.reason || f.reason,
      });
    }
  }

  const totalExpenses = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const remainingBudget = approvedBudget - totalExpenses;
  const isWithinBudget = approvedBudget > 0 ? totalExpenses <= approvedBudget : false;
  const overBudgetBy = approvedBudget > 0 && totalExpenses > approvedBudget ? totalExpenses - approvedBudget : 0;

  const updatedFields: string[] = [];
  if (params.previousPlan) {
    if (params.previousPlan.totalExpenses !== totalExpenses) updatedFields.push('totalExpenses');
    if (params.previousPlan.remainingBudget !== remainingBudget) updatedFields.push('remainingBudget');
    if (params.previousPlan.approvedBudget !== approvedBudget) updatedFields.push('approvedBudget');
  }

  return {
    approvedBudget,
    currency,
    lineItems,
    totalExpenses,
    remainingBudget,
    isWithinBudget,
    overBudgetBy,
    supersededExpenses,
    rationale: `Deterministic ledger summed ${lineItems.length} deduplicated expense lines totaling ${currency} ${totalExpenses.toLocaleString()} against approved budget ${currency} ${approvedBudget.toLocaleString()}.`,
    updatedFields,
  };
}
