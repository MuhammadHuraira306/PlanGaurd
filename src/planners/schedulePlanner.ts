import { invokeModel } from '../ai/modelWrapper.ts';
import type { RunCallBudget } from '../ai/modelWrapper.ts';
import { buildScheduleSynthesisPrompt, SCHEDULE_SYNTHESIS_SCHEMA } from '../ai/prompts.ts';
import { extractNumericFromFact, getActiveFacts } from '../processing/contextManager.ts';
import type {
  AdministrativeDeadline,
  ExtractedFact,
  ModelConfig,
  SchedulePlan,
  ScheduleSlot,
} from '../types/planguard.ts';

function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const m = timeStr.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const mins = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + mins;
}

function formatMinutesToTime(totalMins: number): string {
  const normalized = ((totalMins % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalized / 60);
  const m = normalized % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function extractWindowFromFacts(scheduleFacts: ExtractedFact[]): {
  startMinutes: number;
  endMinutes: number;
  targetDurationMinutes: number;
  explicitWindowFound: boolean;
} {
  let durationMinutes = 240; // Default 4-hour physical hackathon per problem statement
  const durFact = scheduleFacts.find((f) => f.factKey === 'schedule.duration_hours');
  if (durFact) {
    const hrs = extractNumericFromFact(durFact);
    if (hrs && hrs > 0) {
      durationMinutes = Math.round(hrs * 60);
    }
  }

  const windowFact = scheduleFacts.find(
    (f) => f.factKey === 'schedule.event_window' || f.timeRange?.start || f.timeRange?.end,
  );
  if (windowFact) {
    const s = parseTimeToMinutes(windowFact.timeRange?.start);
    const e = parseTimeToMinutes(windowFact.timeRange?.end);
    if (s !== null && e !== null && e > s) {
      return {
        startMinutes: s,
        endMinutes: e,
        targetDurationMinutes: e - s,
        explicitWindowFound: true,
      };
    }
    const text = `${String(windowFact.operationalValue || windowFact.value)} ${windowFact.rawQuote}`;
    const rangeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*(?:-|to|–|until)\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i);
    if (rangeMatch) {
      const ms = parseTimeToMinutes(rangeMatch[1]);
      const me = parseTimeToMinutes(rangeMatch[2]);
      if (ms !== null && me !== null && me > ms) {
        return {
          startMinutes: ms,
          endMinutes: me,
          targetDurationMinutes: me - ms,
          explicitWindowFound: true,
        };
      }
    }
    if (s !== null) {
      return {
        startMinutes: s,
        endMinutes: s + durationMinutes,
        targetDurationMinutes: durationMinutes,
        explicitWindowFound: true,
      };
    }
  }

  // Fallback start 10:00 AM -> 2:00 PM if start time wasn't explicitly specified
  return {
    startMinutes: 10 * 60,
    endMinutes: 10 * 60 + durationMinutes,
    targetDurationMinutes: durationMinutes,
    explicitWindowFound: false,
  };
}

function buildAdministrativeDeadlines(allFacts: ExtractedFact[]): AdministrativeDeadline[] {
  const adminFacts = allFacts.filter(
    (f) => f.isAdministrativeDeadline || f.category === 'administrative_deadline',
  );
  const byKey = new Map<string, ExtractedFact[]>();
  for (const f of adminFacts) {
    const arr = byKey.get(f.factKey) || [];
    arr.push(f);
    byKey.set(f.factKey, arr);
  }

  const results: AdministrativeDeadline[] = [];
  for (const [key, list] of byKey.entries()) {
    const active = list.find((f) => f.status === 'Confirmed' || f.status === 'Accepted');
    if (!active) continue;
    const supersededTimes = list
      .filter((f) => f.status === 'Superseded' || f.status === 'Outdated')
      .map((f) => String(f.operationalValue || f.value));

    results.push({
      name: key.replace(/^administrative_deadline\./, '').replace(/_/g, ' '),
      operationalTime: String(active.operationalValue || active.value),
      announcedTime: active.announcedValue || null,
      supersededTimes,
      sourceMessageId: active.originalMessageId,
      explanation: active.reason,
    });
  }
  return results;
}

export async function planSchedule(params: {
  allFacts: ExtractedFact[];
  requiredJudgingMinutes: number;
  modelConfig: ModelConfig;
  budget: RunCallBudget;
  useAiIfComplex: boolean;
  previousPlan?: SchedulePlan | null;
}): Promise<SchedulePlan> {
  const activeSchedule = getActiveFacts(params.allFacts, 'schedule').filter(
    (f) => !f.isAdministrativeDeadline,
  );
  const { startMinutes, endMinutes, targetDurationMinutes } = extractWindowFromFacts(activeSchedule);
  const administrativeDeadlines = buildAdministrativeDeadlines(params.allFacts);

  // Extract prayer break requirements
  const prayerFacts = activeSchedule.filter((f) => f.factKey.includes('prayer_break'));
  const requiredPrayerBreaks: Array<{ name: string; windowStart: number | null; durationMinutes: number; label: string }> = [];
  for (const pf of prayerFacts) {
    const text = `${pf.summary} ${String(pf.value)} ${pf.rawQuote}`;
    const durMatch = text.match(/(\d{1,3})\s*(?:min|minute|minutes)/i);
    const s = parseTimeToMinutes(pf.timeRange?.start);
    const e = parseTimeToMinutes(pf.timeRange?.end);
    const duration = s !== null && e !== null && e > s ? e - s : durMatch ? Number(durMatch[1]) : 20;
    const name = pf.factKey.replace(/^schedule\.prayer_break_?/, '').replace(/_/g, ' ') || 'Prayer Break';
    requiredPrayerBreaks.push({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      windowStart: s,
      durationMinutes: duration,
      label: `${name} (${duration} min)`,
    });
  }

  // Extract minimum build duration if stated
  const buildDurFact = activeSchedule.find((f) => f.factKey === 'schedule.build_duration');
  const minBuildMinutes = buildDurFact ? (extractNumericFromFact(buildDurFact) ?? 0) * (buildDurFact.unit?.includes('hour') ? 60 : 1) : 0;

  const judgingDurFact = activeSchedule.find((f) => f.factKey === 'schedule.judging_duration');
  const explicitJudgingMins = judgingDurFact
    ? (extractNumericFromFact(judgingDurFact) ?? 0) * (judgingDurFact.unit?.includes('hour') ? 60 : 1)
    : 0;
  const judgingMinutes = Math.max(explicitJudgingMins, params.requiredJudgingMinutes || 45, 30);

  const complexConstraints = activeSchedule
    .filter((f) => f.factKey.startsWith('schedule.constraint_'))
    .map((f) => f.summary);

  let rawSlots: Array<{ title: string; durationMinutes: number; type: ScheduleSlot['type']; notes: string }> = [];
  let rationale = '';

  // Use targeted AI call ONLY if complex qualitative timing constraints exist & budget allows
  if (params.useAiIfComplex && complexConstraints.length > 0 && params.budget.callsUsed < params.budget.maxCalls) {
    try {
      const prompt = buildScheduleSynthesisPrompt({
        startTime: formatMinutesToTime(startMinutes),
        endTime: formatMinutesToTime(endMinutes),
        targetDurationMinutes,
        constraints: complexConstraints,
        requiredPrayerBreaks: requiredPrayerBreaks.map((p) => ({
          name: p.name,
          window: p.windowStart !== null ? formatMinutesToTime(p.windowStart) : 'mid-event',
          durationMinutes: p.durationMinutes,
        })),
        requiredJudgingMinutes: judgingMinutes,
      });

      const res = await invokeModel<{
        slots: Array<{ title: string; durationMinutes: number; type: ScheduleSlot['type']; notes: string }>;
        rationale: string;
      }>({
        budget: params.budget,
        config: params.modelConfig,
        areaTag: 'schedule',
        purpose: 'Synthesize 4-hour timetable satisfying qualitative timing constraints',
        systemInstruction:
          'You are PlanGUARD Schedule Planner. Return exact sequential slots whose durations sum precisely to the target total minutes.',
        prompt,
        responseSchema: SCHEDULE_SYNTHESIS_SCHEMA,
        expectJson: true,
      });

      if (res.parsed && Array.isArray(res.parsed.slots) && res.parsed.slots.length > 0) {
        rawSlots = res.parsed.slots;
        rationale = res.parsed.rationale || 'AI-synthesized timetable verified deterministically.';
      }
    } catch {
      rawSlots = [];
    }
  }

  // Deterministic schedule builder (also repairs/normalizes if AI wasn't needed or sum didn't match)
  const sumRaw = rawSlots.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
  if (rawSlots.length === 0 || sumRaw !== targetDurationMinutes) {
    const openingMins = 15;
    const closingMins = 15;
    const totalPrayerMins = requiredPrayerBreaks.reduce((acc, p) => acc + p.durationMinutes, 0);
    const remainingForBuild = Math.max(0, targetDurationMinutes - openingMins - closingMins - judgingMinutes - totalPrayerMins);

    rawSlots = [
      {
        title: 'Opening Briefing & Problem Release',
        durationMinutes: openingMins,
        type: 'opening',
        notes: 'Check-in, rules briefing, and problem statement release',
      },
    ];

    if (requiredPrayerBreaks.length > 0) {
      // Split build phase around prayer break(s)
      const firstPrayer = requiredPrayerBreaks[0];
      const buildPart1 =
        firstPrayer.windowStart !== null && firstPrayer.windowStart > startMinutes + openingMins
          ? Math.min(remainingForBuild, firstPrayer.windowStart - (startMinutes + openingMins))
          : Math.floor(remainingForBuild * 0.55);
      const buildPart2 = Math.max(0, remainingForBuild - buildPart1);

      if (buildPart1 > 0) {
        rawSlots.push({
          title: 'Sprint Build Phase I',
          durationMinutes: buildPart1,
          type: 'build',
          notes: 'Core architecture and implementation sprint',
        });
      }
      for (const pb of requiredPrayerBreaks) {
        rawSlots.push({
          title: `${pb.name} Break`,
          durationMinutes: pb.durationMinutes,
          type: 'prayer_break',
          notes: 'Scheduled prayer break',
        });
      }
      if (buildPart2 > 0) {
        rawSlots.push({
          title: 'Sprint Build Phase II & Demo Prep',
          durationMinutes: buildPart2,
          type: 'build',
          notes: 'Final integration, testing, and pitch readiness',
        });
      }
    } else {
      rawSlots.push({
        title: 'Hacking & Prototyping Build Window',
        durationMinutes: remainingForBuild,
        type: 'build',
        notes: 'Continuous 4-hour hackathon build window',
      });
    }

    rawSlots.push(
      {
        title: 'Project Evaluation & Judging',
        durationMinutes: judgingMinutes,
        type: 'judging',
        notes: `Parallel judging tracks (${params.requiredJudgingMinutes} min required per judge)`,
      },
      {
        title: 'Results & Closing Ceremony',
        durationMinutes: closingMins,
        type: 'closing',
        notes: 'Winner announcement and prize distribution',
      },
    );

    rationale = `Deterministic ${targetDurationMinutes}-minute schedule constructed cleanly with ${totalPrayerMins}m prayer breaks, ${remainingForBuild}m build time, and ${judgingMinutes}m judging window. Administrative deadlines kept separate from physical timetable.`;
  }

  let cursor = startMinutes;
  const slots: ScheduleSlot[] = rawSlots.map((s, idx) => {
    const start = cursor;
    const end = cursor + s.durationMinutes;
    cursor = end;
    return {
      id: `SLOT-${idx + 1}`,
      title: s.title,
      startTime: formatMinutesToTime(start),
      endTime: formatMinutesToTime(end),
      startMinutes: start,
      endMinutes: end,
      durationMinutes: s.durationMinutes,
      type: s.type,
      notes: s.notes,
    };
  });

  const actualDurationMinutes = slots.reduce((acc, s) => acc + s.durationMinutes, 0);
  const totalBuildMinutes = slots.filter((s) => s.type === 'build').reduce((acc, s) => acc + s.durationMinutes, 0);

  const constraintsSatisfied: string[] = [];
  const constraintsViolated: string[] = [];

  if (actualDurationMinutes === targetDurationMinutes) {
    constraintsSatisfied.push(`Exact ${targetDurationMinutes}-minute event duration verified`);
  } else {
    constraintsViolated.push(`Schedule totals ${actualDurationMinutes} min instead of ${targetDurationMinutes} min`);
  }

  if (minBuildMinutes > 0) {
    if (totalBuildMinutes >= minBuildMinutes) {
      constraintsSatisfied.push(`Build time ${totalBuildMinutes} min >= required ${minBuildMinutes} min`);
    } else {
      constraintsViolated.push(`Build time ${totalBuildMinutes} min < required ${minBuildMinutes} min`);
    }
  }

  if (requiredPrayerBreaks.length > 0) {
    const scheduledPrayers = slots.filter((s) => s.type === 'prayer_break').length;
    if (scheduledPrayers >= requiredPrayerBreaks.length) {
      constraintsSatisfied.push(`${scheduledPrayers} prayer break(s) accommodated`);
    } else {
      constraintsViolated.push('Missing required prayer break in schedule');
    }
  }

  const updatedFields: string[] = [];
  if (params.previousPlan) {
    if (params.previousPlan.slots.length !== slots.length) updatedFields.push('slots');
    if (params.previousPlan.administrativeDeadlines.length !== administrativeDeadlines.length) {
      updatedFields.push('administrativeDeadlines');
    }
  }

  return {
    eventStartTime: formatMinutesToTime(startMinutes),
    eventEndTime: formatMinutesToTime(startMinutes + actualDurationMinutes),
    targetDurationMinutes,
    actualDurationMinutes,
    slots,
    administrativeDeadlines,
    prayerBreaksIncluded: requiredPrayerBreaks.map((p) => p.label),
    constraintsSatisfied,
    constraintsViolated,
    rationale,
    updatedFields,
  };
}
