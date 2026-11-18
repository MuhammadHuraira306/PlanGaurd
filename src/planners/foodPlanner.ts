import { extractNumericFromFact, getActiveFacts } from '../processing/contextManager.ts';
import type { ExtractedFact, FoodPlan } from '../types/planguard.ts';

export function planFood(facts: ExtractedFact[], previousPlan?: FoodPlan | null): FoodPlan {
  const activeAttendance = getActiveFacts(facts, 'attendance');
  const activeJudging = getActiveFacts(facts, 'judging');
  const activeFood = getActiveFacts(facts, 'food');
  const rejectedFoodFacts = facts.filter(
    (f) => f.category === 'food' && f.status === 'Rejected',
  );

  const getNum = (list: ExtractedFact[], key: string): number => {
    const f = list.find((x) => x.factKey === key);
    return f ? extractNumericFromFact(f) ?? 0 : 0;
  };

  const students = getNum(activeAttendance, 'attendance.students');
  const teamCount = getNum(activeAttendance, 'attendance.teams');
  const judges =
    getNum(activeAttendance, 'attendance.judges') || getNum(activeJudging, 'judging.available_judges');
  const organizers =
    getNum(activeAttendance, 'attendance.organizers') + getNum(activeAttendance, 'attendance.volunteers');
  const guests = getNum(activeAttendance, 'attendance.guests') + getNum(activeAttendance, 'attendance.mentors');
  const explicitTotal = getNum(activeAttendance, 'attendance.total_people');

  const componentSum = students + judges + organizers + guests;
  const peopleRequiringFood = Math.max(explicitTotal, componentSum);

  const unitPrice =
    getNum(activeFood, 'food.unit_price') ||
    getNum(activeFood, 'food.price_per_box') ||
    getNum(activeFood, 'food.price_per_person');
  const deliveryCharge = getNum(activeFood, 'food.delivery_charge');
  const explicitQty = getNum(activeFood, 'food.order_quantity') || getNum(activeFood, 'food.boxes');

  const mealTypeFact = activeFood.find((f) => f.factKey === 'food.meal_type');
  const mealType = mealTypeFact ? String(mealTypeFact.operationalValue || mealTypeFact.value) : 'Meal Boxes';

  const dietaryRestrictions = activeFood
    .filter((f) => f.factKey.startsWith('food.dietary_') || f.factKey === 'food.coverage_rule')
    .map((f) => f.summary);

  const rejectedOrders = rejectedFoodFacts
    .filter((f) => f.factKey === 'food.order_quantity' || f.factKey === 'food.boxes')
    .map((f) => ({
      quantity: extractNumericFromFact(f) ?? 0,
      reason: f.reason,
      messageId: f.originalMessageId,
    }));

  // Ensure quantity always covers everyone requiring food (never allow under-ordering or team-count confusion)
  const orderedQuantity = Math.max(peopleRequiringFood, explicitQty >= peopleRequiringFood ? explicitQty : peopleRequiringFood);
  const totalFoodCost = orderedQuantity * unitPrice + deliveryCharge;

  const constraintsSatisfied: string[] = [];
  const constraintsViolated: string[] = [];

  if (peopleRequiringFood > 0) {
    if (orderedQuantity >= peopleRequiringFood) {
      constraintsSatisfied.push(
        `Ordered ${orderedQuantity} units covering all ${peopleRequiringFood} attendees (distinct from ${teamCount} teams).`,
      );
    } else {
      constraintsViolated.push(`Food quantity (${orderedQuantity}) is below required headcount (${peopleRequiringFood}).`);
    }
  } else {
    constraintsViolated.push('Attendance headcount not yet established for food calculation.');
  }

  if (unitPrice > 0) {
    constraintsSatisfied.push(`Unit price applied: ${unitPrice} per person + ${deliveryCharge} delivery`);
  }

  const updatedFields: string[] = [];
  if (previousPlan) {
    if (previousPlan.peopleRequiringFood !== peopleRequiringFood) updatedFields.push('peopleRequiringFood');
    if (previousPlan.orderedQuantity !== orderedQuantity) updatedFields.push('orderedQuantity');
    if (previousPlan.totalFoodCost !== totalFoodCost) updatedFields.push('totalFoodCost');
    if (previousPlan.unitPrice !== unitPrice) updatedFields.push('unitPrice');
  }

  return {
    peopleRequiringFood,
    teamCount,
    headcountBreakdown: {
      students,
      judges,
      organizers,
      guests,
    },
    unitPrice,
    deliveryCharge,
    orderedQuantity,
    totalFoodCost,
    mealType,
    dietaryRestrictions,
    rejectedOrders,
    constraintsSatisfied,
    constraintsViolated,
    rationale: `Calculated food coverage for ${peopleRequiringFood} total people (${students} students, ${judges} judges, ${organizers} organizers/volunteers, ${guests} guests/mentors) at ${unitPrice}/unit + ${deliveryCharge} delivery = ${totalFoodCost}.`,
    updatedFields,
  };
}
