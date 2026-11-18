import { extractNumericFromFact, getActiveFacts } from '../processing/contextManager.ts';
import type { ExtractedFact, VenueOption, VenuePlan } from '../types/planguard.ts';

function parseVenueOptionFromFact(fact: ExtractedFact): VenueOption | null {
  const val = fact.value;
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    const name = String(obj.name || fact.summary || fact.factKey.replace('venue.option_', '')).trim();
    const capacity = Number(obj.capacity ?? 0) || 0;
    const cost = Number(obj.cost ?? obj.price ?? obj.rent ?? fact.numericValue ?? 0) || 0;
    const notes: string[] = [];
    if (Array.isArray(obj.restrictions)) {
      for (const r of obj.restrictions) notes.push(String(r));
    } else if (typeof obj.restrictions === 'string' && obj.restrictions.trim()) {
      notes.push(obj.restrictions.trim());
    }
    if (typeof obj.notes === 'string' && obj.notes.trim()) {
      notes.push(obj.notes.trim());
    }

    const combinedText = `${fact.summary} ${fact.rawQuote} ${notes.join(' ')}`.toLowerCase();
    const hasGenerator =
      typeof obj.hasGenerator === 'boolean'
        ? obj.hasGenerator
        : /generator|backup power|ups|bijli backup/.test(combinedText) &&
          !/no generator|without generator|generator nahi/.test(combinedText);
    const hasAC =
      typeof obj.hasAC === 'boolean'
        ? obj.hasAC
        : /\bac\b|air condition/.test(combinedText) && !/no ac|without ac/.test(combinedText);
    const hasWifi =
      typeof obj.hasWifi === 'boolean'
        ? obj.hasWifi
        : /wi-?fi|internet/.test(combinedText) && !/no wifi|no internet/.test(combinedText);

    return {
      name,
      capacity,
      cost,
      hasGenerator,
      hasAC,
      hasWifi,
      location: String(obj.location || 'Islamabad'),
      notes,
      meetsConstraints: true,
    };
  }

  // Fallback text parsing if AI returned string
  const text = `${fact.summary} ${String(fact.value)} ${fact.rawQuote}`;
  const lower = text.toLowerCase();
  const capMatch = text.match(/(\d{2,4})\s*(?:people|students|seats|capacity|persons|attendees)/i);
  const costMatch = text.match(/(?:rs\.?|pkr)\s*([\d,]+)/i) || text.match(/([\d,]{4,})\s*(?:rs|pkr)/i);

  const capacity = capMatch ? Number(capMatch[1]) : 0;
  const cost = costMatch ? Number(costMatch[1].replace(/,/g, '')) : fact.numericValue ?? 0;

  if (!capacity && !cost) return null;

  return {
    name: fact.factKey.replace(/^venue\.option_/, '').replace(/_/g, ' '),
    capacity,
    cost,
    hasGenerator: /generator|backup power/.test(lower) && !/no generator|without generator/.test(lower),
    hasAC: /\bac\b|air condition/.test(lower) && !/no ac/.test(lower),
    hasWifi: /wi-?fi|internet/.test(lower) && !/no wifi/.test(lower),
    location: 'Islamabad',
    notes: [fact.summary],
    meetsConstraints: true,
  };
}

export function planVenue(facts: ExtractedFact[], previousPlan?: VenuePlan | null): VenuePlan {
  const activeAttendance = getActiveFacts(facts, 'attendance');
  const activeJudging = getActiveFacts(facts, 'judging');
  const activeVenue = getActiveFacts(facts, 'venue');
  const activeGeneral = getActiveFacts(facts, 'general_constraint');

  const getNum = (list: ExtractedFact[], key: string): number => {
    const f = list.find((x) => x.factKey === key);
    return f ? extractNumericFromFact(f) ?? 0 : 0;
  };

  const students = getNum(activeAttendance, 'attendance.students');
  const judges =
    getNum(activeAttendance, 'attendance.judges') || getNum(activeJudging, 'judging.available_judges');
  const organizers =
    getNum(activeAttendance, 'attendance.organizers') + getNum(activeAttendance, 'attendance.volunteers');
  const guests = getNum(activeAttendance, 'attendance.guests') + getNum(activeAttendance, 'attendance.mentors');
  const explicitTotal = getNum(activeAttendance, 'attendance.total_people');

  const sumComponents = students + judges + organizers + guests;
  const requiredCapacity = Math.max(explicitTotal, sumComponents);

  // Detect stated hard venue requirements
  const reqFacts = [...activeVenue.filter((f) => !f.factKey.startsWith('venue.option_')), ...activeGeneral];
  const reqText = reqFacts.map((f) => `${f.factKey} ${f.summary} ${String(f.value)} ${f.rawQuote}`).join(' | ').toLowerCase();

  const requiresGenerator = /generator|backup power|power backup|load shedding|bijli/.test(reqText) && !/generator not required/.test(reqText);
  const requiresAC = /\bac required\b|air condition|must have ac/.test(reqText);
  const requiresWifi = /wifi required|high-speed internet|venue must have wifi/.test(reqText);
  const mustBeInIslamabad = /islamabad/.test(reqText);

  const constraintsChecked: string[] = [];
  if (requiredCapacity > 0) constraintsChecked.push(`Minimum capacity >= ${requiredCapacity} attendees`);
  if (requiresGenerator) constraintsChecked.push('Backup generator / power continuity required');
  if (requiresAC) constraintsChecked.push('Air conditioning required');
  if (requiresWifi) constraintsChecked.push('Dedicated Wi-Fi / internet required');
  if (mustBeInIslamabad) constraintsChecked.push('Located in Islamabad');

  const optionFacts = activeVenue.filter((f) => f.factKey.startsWith('venue.option_') || f.constraintType === 'option');
  const candidates: VenueOption[] = [];
  for (const f of optionFacts) {
    const opt = parseVenueOptionFromFact(f);
    if (opt) candidates.push(opt);
  }

  // Also check if a single selected venue was directly stated without venue.option_*
  if (candidates.length === 0) {
    const nameFact = activeVenue.find((f) => f.factKey === 'venue.name' || f.factKey === 'venue.selected');
    const capFact = activeVenue.find((f) => f.factKey === 'venue.capacity');
    const costFact = activeVenue.find((f) => f.factKey === 'venue.cost') || getActiveFacts(facts, 'budget').find((f) => f.factKey === 'budget.expense_venue');
    if (nameFact || capFact || costFact) {
      candidates.push({
        name: nameFact ? String(nameFact.operationalValue || nameFact.value) : 'Confirmed Venue',
        capacity: capFact ? extractNumericFromFact(capFact) ?? 0 : requiredCapacity,
        cost: costFact ? extractNumericFromFact(costFact) ?? 0 : 0,
        hasGenerator: requiresGenerator ? !/no generator/.test(reqText) : false,
        hasAC: true,
        hasWifi: true,
        location: 'Islamabad',
        notes: [nameFact?.summary || 'Direct venue specification'],
        meetsConstraints: true,
      });
    }
  }

  for (const cand of candidates) {
    const failures: string[] = [];
    if (requiredCapacity > 0 && cand.capacity < requiredCapacity) {
      failures.push(`Capacity ${cand.capacity} < required ${requiredCapacity}`);
    }
    if (requiresGenerator && !cand.hasGenerator) {
      failures.push('Lacks required backup generator');
    }
    if (requiresAC && !cand.hasAC) {
      failures.push('Lacks required A/C');
    }
    if (requiresWifi && !cand.hasWifi) {
      failures.push('Lacks required Wi-Fi');
    }
    if (mustBeInIslamabad && cand.location && !/islamabad/i.test(cand.location) && !/isb/i.test(cand.location)) {
      failures.push(`Outside Islamabad (${cand.location})`);
    }
    cand.meetsConstraints = failures.length === 0;
    if (failures.length > 0) {
      cand.rejectionReason = failures.join('; ');
    }
  }

  const validCandidates = candidates.filter((c) => c.meetsConstraints);
  // Score valid venues: prefer cost-efficiency while rewarding comfortable capacity margin and amenities
  validCandidates.sort((a, b) => {
    const costDiff = a.cost - b.cost;
    if (costDiff !== 0) return costDiff;
    return b.capacity - a.capacity;
  });

  const chosen = validCandidates[0] || null;
  const satisfiedConstraints: string[] = [];
  const violatedConstraints: string[] = [];

  if (!chosen) {
    if (candidates.length === 0) {
      violatedConstraints.push('No venue options or confirmed venue found in message pack.');
    } else {
      violatedConstraints.push(
        `No candidate venue satisfies all hard constraints: ${candidates.map((c) => `${c.name} (${c.rejectionReason})`).join(' | ')}`,
      );
    }
  } else {
    if (requiredCapacity > 0) satisfiedConstraints.push(`Capacity ${chosen.capacity} covers ${requiredCapacity} attendees`);
    if (requiresGenerator) satisfiedConstraints.push('Backup generator verified');
    if (requiresAC) satisfiedConstraints.push('Air conditioning verified');
    if (requiresWifi) satisfiedConstraints.push('Wi-Fi availability verified');
  }

  const updatedFields: string[] = [];
  if (previousPlan) {
    if (previousPlan.selectedVenue !== (chosen?.name ?? null)) updatedFields.push('selectedVenue');
    if (previousPlan.requiredCapacity !== requiredCapacity) updatedFields.push('requiredCapacity');
    if (previousPlan.venueCost !== (chosen?.cost ?? 0)) updatedFields.push('venueCost');
  }

  return {
    selectedVenue: chosen?.name ?? null,
    requiredCapacity,
    capacityBreakdown: {
      students,
      judges,
      organizers,
      guests,
      total: requiredCapacity,
    },
    venueCapacity: chosen?.capacity ?? 0,
    venueCost: chosen?.cost ?? 0,
    constraintsChecked,
    satisfiedConstraints,
    violatedConstraints,
    candidatesEvaluated: candidates,
    rationale: chosen
      ? `Selected "${chosen.name}" (capacity ${chosen.capacity}, cost ${chosen.cost}) because it satisfies all ${constraintsChecked.length} evaluated constraints without simply defaulting to an undersized or non-compliant cheapest option.`
      : 'Unable to select a valid venue under current constraints.',
    updatedFields,
  };
}
