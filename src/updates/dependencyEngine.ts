import type { PlanningArea } from '../types/planguard.ts';

const ALL_AREAS: PlanningArea[] = ['venue', 'schedule', 'food', 'judging', 'budget'];

export function predictAffectedAreas(changedFactKeys: string[]): {
  affectedAreas: PlanningArea[];
  unaffectedAreas: PlanningArea[];
  reasoning: string[];
} {
  if (changedFactKeys.length === 0) {
    return {
      affectedAreas: [],
      unaffectedAreas: [...ALL_AREAS],
      reasoning: ['No active facts changed (message was rejected, outdated, irrelevant, or redundant).'],
    };
  }

  const affected = new Set<PlanningArea>();
  const reasoning: string[] = [];

  for (const key of changedFactKeys) {
    if (key.startsWith('attendance.')) {
      if (key === 'attendance.teams') {
        affected.add('judging');
        affected.add('budget');
        reasoning.push(`${key} -> affects judging capacity and potentially judge honorarium/budget`);
      } else {
        affected.add('venue');
        affected.add('food');
        affected.add('budget');
        if (key === 'attendance.judges') {
          affected.add('judging');
        }
        reasoning.push(`${key} -> affects venue capacity, food headcount, and budget`);
      }
    } else if (key.startsWith('venue.')) {
      affected.add('venue');
      affected.add('budget');
      if (key.includes('timing') || key.includes('hours') || key.includes('curfew')) {
        affected.add('schedule');
      }
      if (key.includes('catering') || key.includes('food')) {
        affected.add('food');
      }
      reasoning.push(`${key} -> affects venue selection and venue cost in budget`);
    } else if (key.startsWith('schedule.')) {
      affected.add('schedule');
      if (key.includes('judging')) {
        affected.add('judging');
      }
      reasoning.push(`${key} -> affects schedule timetable`);
    } else if (key.startsWith('food.')) {
      affected.add('food');
      affected.add('budget');
      reasoning.push(`${key} -> affects food calculation and food cost in budget`);
    } else if (key.startsWith('judging.')) {
      affected.add('judging');
      if (key.includes('honorarium')) {
        affected.add('budget');
      }
      if (key.includes('minutes') || key.includes('available_judges') || key.includes('max_teams')) {
        affected.add('schedule');
      }
      reasoning.push(`${key} -> affects judging allocation (and dependent schedule/budget if applicable)`);
    } else if (key.startsWith('budget.')) {
      affected.add('budget');
      reasoning.push(`${key} -> affects budget ledger only`);
    } else if (key.startsWith('administrative_deadline.')) {
      // Administrative deadlines (e.g. code freeze) live in schedule.administrativeDeadlines metadata,
      // NOT the 4-hour physical timetable, and require 0 AI planning calls!
      affected.add('schedule');
      reasoning.push(`${key} -> updates administrative deadline metadata without altering 4-hour timetable slots`);
    } else {
      // Unknown general constraint: evaluate venue/schedule/food conservatively
      affected.add('venue');
      affected.add('schedule');
      affected.add('food');
      affected.add('judging');
      affected.add('budget');
      reasoning.push(`${key} -> general constraint checked across planning areas`);
    }
  }

  const affectedAreas = ALL_AREAS.filter((a) => affected.has(a));
  const unaffectedAreas = ALL_AREAS.filter((a) => !affected.has(a));
  return { affectedAreas, unaffectedAreas, reasoning };
}
