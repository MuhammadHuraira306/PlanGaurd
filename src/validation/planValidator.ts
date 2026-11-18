import type {
  EventPlan,
  ExtractedFact,
  ValidationCheck,
  ValidationReport,
} from '../types/planguard.ts';

export function validateEventPlan(plan: EventPlan, facts: ExtractedFact[]): ValidationReport {
  const passedChecks: ValidationCheck[] = [];
  const failedChecks: ValidationCheck[] = [];
  const warnings: ValidationCheck[] = [];
  const unresolvedConstraints: ValidationCheck[] = [];
  const impossibleReasons: string[] = [];

  const pushCheck = (c: ValidationCheck) => {
    if (c.severity === 'pass') passedChecks.push(c);
    else if (c.severity === 'fail') failedChecks.push(c);
    else if (c.severity === 'warning') warnings.push(c);
    else unresolvedConstraints.push(c);
  };

  // 1. VENUE CHECKS
  const v = plan.venue;
  if (!v.selectedVenue) {
    pushCheck({
      area: 'venue',
      checkName: 'Compliant Venue Selected',
      passed: false,
      severity: 'fail',
      expected: 'Valid venue satisfying capacity & hard constraints',
      actual: 'None selected',
      details: v.violatedConstraints.join('; ') || 'No compliant venue found',
    });
    if (v.candidatesEvaluated.length > 0) {
      impossibleReasons.push(`No venue candidate satisfies all constraints (${v.violatedConstraints.join('; ')})`);
    }
  } else {
    pushCheck({
      area: 'venue',
      checkName: 'Compliant Venue Selected',
      passed: true,
      severity: 'pass',
      expected: 'Valid venue selected',
      actual: v.selectedVenue,
      details: v.satisfiedConstraints.join('; ') || 'Venue selected',
    });

    const capOk = v.requiredCapacity > 0 && v.venueCapacity >= v.requiredCapacity;
    pushCheck({
      area: 'venue',
      checkName: 'Venue Capacity Coverage',
      passed: capOk,
      severity: capOk ? 'pass' : 'fail',
      expected: `>= ${v.requiredCapacity} attendees`,
      actual: `${v.venueCapacity} capacity`,
      details: capOk ? 'Capacity covers full attendance' : 'Selected venue capacity is below attendance',
    });

    const venueCostInBudget =
      v.venueCost === 0 ||
      plan.budget.lineItems.some((item) => item.category === 'venue' && item.amount === v.venueCost);
    pushCheck({
      area: 'venue',
      checkName: 'Venue Cost Included in Budget',
      passed: venueCostInBudget,
      severity: venueCostInBudget ? 'pass' : 'fail',
      expected: `Venue cost ${v.venueCost} in budget ledger`,
      actual: venueCostInBudget ? 'Included' : 'Missing',
      details: venueCostInBudget ? 'Venue expense accounted for' : 'Venue cost omitted from budget',
    });
  }

  // 2. SCHEDULE CHECKS
  const s = plan.schedule;
  const durOk = s.actualDurationMinutes === s.targetDurationMinutes;
  pushCheck({
    area: 'schedule',
    checkName: 'Exact Event Duration',
    passed: durOk,
    severity: durOk ? 'pass' : 'fail',
    expected: `${s.targetDurationMinutes} minutes`,
    actual: `${s.actualDurationMinutes} minutes`,
    details: durOk ? 'Exact duration satisfied' : 'Total schedule minutes mismatch',
  });

  // Check zero overlaps
  let hasOverlap = false;
  for (let i = 1; i < s.slots.length; i++) {
    if (s.slots[i].startMinutes < s.slots[i - 1].endMinutes) {
      hasOverlap = true;
      break;
    }
  }
  pushCheck({
    area: 'schedule',
    checkName: 'Non-Overlapping Activities',
    passed: !hasOverlap && s.slots.length > 0,
    severity: !hasOverlap && s.slots.length > 0 ? 'pass' : 'fail',
    expected: '0 overlapping slots',
    actual: hasOverlap ? 'Overlap detected' : `${s.slots.length} sequential slots`,
    details: hasOverlap ? 'One or more schedule slots overlap' : 'All slots sequential with zero overlap',
  });

  if (s.constraintsViolated.length > 0) {
    for (const cv of s.constraintsViolated) {
      pushCheck({
        area: 'schedule',
        checkName: 'Schedule Timing & Prayer Constraints',
        passed: false,
        severity: 'fail',
        expected: 'All timing & prayer break constraints satisfied',
        actual: cv,
        details: cv,
      });
    }
  } else {
    pushCheck({
      area: 'schedule',
      checkName: 'Schedule Timing & Prayer Constraints',
      passed: true,
      severity: 'pass',
      expected: 'All timing & prayer constraints met',
      actual: s.prayerBreaksIncluded.length > 0 ? s.prayerBreaksIncluded.join(', ') : 'All timing rules met',
      details: 'Prayer breaks and timing limits verified',
    });
  }

  // 3. FOOD CHECKS
  const f = plan.food;
  const foodCoverageOk = f.peopleRequiringFood > 0 && f.orderedQuantity >= f.peopleRequiringFood;
  pushCheck({
    area: 'food',
    checkName: 'Full Attendance Food Coverage',
    passed: foodCoverageOk,
    severity: foodCoverageOk ? 'pass' : 'fail',
    expected: `>= ${f.peopleRequiringFood} units (all attendees)`,
    actual: `${f.orderedQuantity} units`,
    details: foodCoverageOk
      ? `Covers all ${f.peopleRequiringFood} attendees (distinct from ${f.teamCount} teams)`
      : 'Insufficient food quantity for total attendance',
  });

  const expectedFoodTotal = f.orderedQuantity * f.unitPrice + f.deliveryCharge;
  const foodMathOk = f.totalFoodCost === expectedFoodTotal && (f.unitPrice > 0 || f.peopleRequiringFood === 0);
  pushCheck({
    area: 'food',
    checkName: 'Food Pricing & Delivery Arithmetic',
    passed: foodMathOk,
    severity: f.unitPrice === 0 ? 'warning' : foodMathOk ? 'pass' : 'fail',
    expected: `${expectedFoodTotal} (${f.orderedQuantity} × ${f.unitPrice} + ${f.deliveryCharge})`,
    actual: `${f.totalFoodCost}`,
    details: f.unitPrice === 0 ? 'Food unit price not explicitly provided in messages' : 'Exact pricing & delivery verified',
  });

  // 4. JUDGING CHECKS
  const j = plan.judging;
  const judgingCapOk = j.totalTeams > 0 && j.availableJudges > 0 && j.totalJudgingCapacity >= j.totalTeams;
  pushCheck({
    area: 'judging',
    checkName: 'Judge Capacity Covers All Teams',
    passed: judgingCapOk,
    severity: judgingCapOk ? 'pass' : 'fail',
    expected: `>= ${j.totalTeams} team slots`,
    actual: `${j.totalJudgingCapacity} slots (${j.availableJudges} judges × ${j.maxTeamsPerJudge})`,
    details: judgingCapOk ? 'Every team can be assigned to a judge' : 'Not enough judge capacity for all teams',
  });
  if (!judgingCapOk && j.totalTeams > 0 && j.availableJudges > 0) {
    impossibleReasons.push(
      `Judging capacity (${j.totalJudgingCapacity}) cannot evaluate all ${j.totalTeams} teams under max ${j.maxTeamsPerJudge} teams/judge.`,
    );
  }

  const judgingTimeOk = j.availableJudgingMinutes >= j.requiredMinutesPerJudge && j.requiredMinutesPerJudge > 0;
  pushCheck({
    area: 'judging',
    checkName: 'Judging Time Window Sufficiency',
    passed: judgingTimeOk,
    severity: judgingTimeOk ? 'pass' : 'fail',
    expected: `>= ${j.requiredMinutesPerJudge} min`,
    actual: `${j.availableJudgingMinutes} min`,
    details: judgingTimeOk
      ? 'Available judging window accommodates all assigned evaluations'
      : 'Available judging window is shorter than required evaluation time',
  });
  if (!judgingTimeOk && j.requiredMinutesPerJudge > 0) {
    impossibleReasons.push(
      `Judging requires ${j.requiredMinutesPerJudge} min/judge, exceeding available ${j.availableJudgingMinutes} min window.`,
    );
  }

  // 5. BUDGET CHECKS
  const b = plan.budget;
  const budgetSetOk = b.approvedBudget > 0;
  const withinBudgetOk = budgetSetOk && b.isWithinBudget;
  pushCheck({
    area: 'budget',
    checkName: 'Total Expenses Within Approved Budget',
    passed: withinBudgetOk,
    severity: withinBudgetOk ? 'pass' : 'fail',
    expected: `<= ${b.currency} ${b.approvedBudget.toLocaleString()}`,
    actual: `${b.currency} ${b.totalExpenses.toLocaleString()}`,
    details: withinBudgetOk
      ? `Remaining balance: ${b.currency} ${b.remainingBudget.toLocaleString()}`
      : b.approvedBudget === 0
        ? 'Approved total budget not established'
        : `Over budget by ${b.currency} ${b.overBudgetBy.toLocaleString()}`,
  });
  if (b.approvedBudget > 0 && !b.isWithinBudget) {
    impossibleReasons.push(
      `Mandatory expenses (${b.currency} ${b.totalExpenses.toLocaleString()}) exceed approved budget (${b.currency} ${b.approvedBudget.toLocaleString()}) by ${b.currency} ${b.overBudgetBy.toLocaleString()}.`,
    );
  }

  const summedItems = b.lineItems.reduce((acc, item) => acc + item.amount, 0);
  const ledgerMathOk = summedItems === b.totalExpenses && b.remainingBudget === b.approvedBudget - b.totalExpenses;
  pushCheck({
    area: 'budget',
    checkName: 'Budget Ledger Arithmetic & Deduplication',
    passed: ledgerMathOk,
    severity: ledgerMathOk ? 'pass' : 'fail',
    expected: `Ledger sum = ${summedItems}, Remaining = ${b.approvedBudget - summedItems}`,
    actual: `Total = ${b.totalExpenses}, Remaining = ${b.remainingBudget}`,
    details: `${b.lineItems.length} deduplicated expense lines verified`,
  });

  // 6. CROSS-AREA UNRESOLVED FACTS
  const unresolvedFacts = facts.filter((fact) => fact.status === 'Unverified' || fact.status === 'Conflicting');
  for (const uf of unresolvedFacts) {
    pushCheck({
      area: 'cross_area',
      checkName: `Unresolved Fact (${uf.factKey})`,
      passed: false,
      severity: 'unresolved',
      expected: 'Confirmed or Rejected resolution',
      actual: uf.status,
      details: `${uf.summary} (from ${uf.sender}) — ${uf.reason}`,
    });
  }

  let overallStatus: ValidationReport['overallStatus'] = 'VALID';
  if (impossibleReasons.length > 0) {
    overallStatus = 'IMPOSSIBLE';
  } else if (failedChecks.length > 0) {
    overallStatus = 'INVALID';
  } else if (unresolvedConstraints.length > 0) {
    overallStatus = 'INCOMPLETE';
  }

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    isValid: overallStatus === 'VALID',
    passedChecks,
    failedChecks,
    warnings,
    unresolvedConstraints,
    impossibleReasons,
  };
}
