import { extractNumericFromFact, getActiveFacts } from '../processing/contextManager.ts';
import type { ExtractedFact, JudgingPlan } from '../types/planguard.ts';

export function planJudging(facts: ExtractedFact[], previousPlan?: JudgingPlan | null): JudgingPlan {
  const activeAttendance = getActiveFacts(facts, 'attendance');
  const activeJudging = getActiveFacts(facts, 'judging');
  const activeSchedule = getActiveFacts(facts, 'schedule');
  const activeBudget = getActiveFacts(facts, 'budget');

  const getNum = (list: ExtractedFact[], key: string): number => {
    const f = list.find((x) => x.factKey === key);
    return f ? extractNumericFromFact(f) ?? 0 : 0;
  };

  const totalTeams =
    getNum(activeAttendance, 'attendance.teams') || getNum(activeJudging, 'judging.total_teams');
  const availableJudges =
    getNum(activeJudging, 'judging.available_judges') || getNum(activeAttendance, 'attendance.judges');
  const maxTeamsPerJudge = getNum(activeJudging, 'judging.max_teams_per_judge') || totalTeams;
  const minutesPerTeam = getNum(activeJudging, 'judging.minutes_per_team') || 5;
  const parallelTracks =
    getNum(activeJudging, 'judging.parallel_tracks') || Math.max(1, availableJudges);
  const honorariumPerJudge = getNum(activeJudging, 'judging.honorarium_per_judge');

  const explicitJudgeBudget = getNum(activeBudget, 'budget.expense_judges');
  const totalJudgeHonorarium =
    honorariumPerJudge > 0 && availableJudges > 0
      ? honorariumPerJudge * availableJudges
      : explicitJudgeBudget;

  const judgingDurFact = activeSchedule.find((f) => f.factKey === 'schedule.judging_duration');
  const explicitWindowMins = judgingDurFact
    ? (extractNumericFromFact(judgingDurFact) ?? 0) * (judgingDurFact.unit?.includes('hour') ? 60 : 1)
    : 0;

  const totalJudgingCapacity = availableJudges * maxTeamsPerJudge;
  const teamsPerJudgeAssigned: number[] = [];

  if (availableJudges > 0 && totalTeams > 0) {
    const base = Math.floor(totalTeams / availableJudges);
    const rem = totalTeams % availableJudges;
    for (let i = 0; i < availableJudges; i++) {
      teamsPerJudgeAssigned.push(base + (i < rem ? 1 : 0));
    }
  }

  const maxAssigned = teamsPerJudgeAssigned.length > 0 ? Math.max(...teamsPerJudgeAssigned) : 0;
  const requiredMinutesPerJudge = maxAssigned * minutesPerTeam;
  const availableJudgingMinutes = explicitWindowMins > 0 ? explicitWindowMins : Math.max(requiredMinutesPerJudge, 45);
  const judgingRounds = maxAssigned;

  const constraintsSatisfied: string[] = [];
  const constraintsViolated: string[] = [];

  if (totalTeams <= 0) {
    constraintsViolated.push('Number of teams not established.');
  }
  if (availableJudges <= 0) {
    constraintsViolated.push('Available judges count not established.');
  }
  if (totalTeams > 0 && availableJudges > 0) {
    if (totalJudgingCapacity >= totalTeams) {
      constraintsSatisfied.push(
        `Capacity verified: ${availableJudges} judges × max ${maxTeamsPerJudge} teams = ${totalJudgingCapacity} slots >= ${totalTeams} teams.`,
      );
    } else {
      constraintsViolated.push(
        `Insufficient judging capacity: ${availableJudges} × ${maxTeamsPerJudge} = ${totalJudgingCapacity} < ${totalTeams} teams.`,
      );
    }

    if (maxAssigned <= maxTeamsPerJudge) {
      constraintsSatisfied.push(`Max teams per judge respected (${maxAssigned} <= ${maxTeamsPerJudge}).`);
    } else {
      constraintsViolated.push(`Assigned teams per judge (${maxAssigned}) exceeds limit (${maxTeamsPerJudge}).`);
    }

    if (explicitWindowMins > 0) {
      if (requiredMinutesPerJudge <= explicitWindowMins) {
        constraintsSatisfied.push(
          `Judging duration sufficient: ${requiredMinutesPerJudge} min needed <= ${explicitWindowMins} min available.`,
        );
      } else {
        constraintsViolated.push(
          `Insufficient judging time: ${requiredMinutesPerJudge} min needed > ${explicitWindowMins} min available.`,
        );
      }
    } else {
      constraintsSatisfied.push(`Allocated ${requiredMinutesPerJudge} min judging window (${maxAssigned} teams × ${minutesPerTeam} min).`);
    }
  }

  const updatedFields: string[] = [];
  if (previousPlan) {
    if (previousPlan.availableJudges !== availableJudges) updatedFields.push('availableJudges');
    if (previousPlan.totalTeams !== totalTeams) updatedFields.push('totalTeams');
    if (previousPlan.requiredMinutesPerJudge !== requiredMinutesPerJudge) {
      updatedFields.push('requiredMinutesPerJudge');
    }
  }

  return {
    totalTeams,
    availableJudges,
    maxTeamsPerJudge,
    minutesPerTeam,
    totalJudgingCapacity,
    teamsPerJudgeAssigned,
    availableJudgingMinutes,
    requiredMinutesPerJudge,
    parallelTracks,
    judgingRounds,
    honorariumPerJudge,
    totalJudgeHonorarium,
    constraintsSatisfied,
    constraintsViolated,
    rationale: `Distributed ${totalTeams} teams across ${availableJudges} judges (${teamsPerJudgeAssigned.join(', ')} teams each). Required time per judge: ${requiredMinutesPerJudge} min.`,
    updatedFields,
  };
}
