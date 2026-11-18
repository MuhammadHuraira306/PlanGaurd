export type FactStatus =
  | 'Confirmed'
  | 'Accepted'
  | 'Conflicting'
  | 'Superseded'
  | 'Outdated'
  | 'Unverified'
  | 'Rejected'
  | 'Irrelevant';

export type AreaTag =
  | 'reading'
  | 'venue'
  | 'schedule'
  | 'food'
  | 'judging'
  | 'budget';

export type PlanningArea = 'venue' | 'schedule' | 'food' | 'judging' | 'budget';

export type FactCategory =
  | 'attendance'
  | 'venue'
  | 'schedule'
  | 'food'
  | 'judging'
  | 'budget'
  | 'administrative_deadline'
  | 'general_constraint'
  | 'irrelevant';

export type AuthorityLevel = 'high' | 'medium' | 'low' | 'unverified';

export type ConflictClassification =
  | 'genuine_update'
  | 'outdated_announcement'
  | 'contradiction'
  | 'misleading_statement'
  | 'irrelevant_message'
  | 'explicit_correction'
  | 'new_constraint'
  | 'unauthorized_instruction'
  | 'operational_clarification'
  | 'consistent_addition';

export type MessageSourceType =
  | 'message_pack'
  | 'incremental_message'
  | 'external_authoritative_clarification';

export interface ParsedMessage {
  id: string;
  index: number;
  rawText: string;
  body: string;
  sender: string;
  senderRole: string;
  authorityLevel: AuthorityLevel;
  timestamp: string;
  channel: 'email' | 'whatsapp' | 'notice' | 'clarification' | 'unknown';
  language: 'en' | 'roman_urdu' | 'mixed' | 'unknown';
  sourceType: MessageSourceType;
  sourceFile: string;
  uncertainBoundary: boolean;
  parseNotes: string[];
  processingStatus: 'pending' | 'accepted' | 'partially_accepted' | 'rejected' | 'conflicting' | 'unverified' | 'irrelevant' | 'superseded' | 'outdated';
  decisionReason: string;
  receivedAt: string;
}

export interface FactHistoryEntry {
  timestamp: string;
  previousStatus: FactStatus | null;
  newStatus: FactStatus;
  reason: string;
  triggeredByMessageId: string;
}

export interface ExtractedFact {
  id: string;
  category: FactCategory;
  factKey: string;
  summary: string;
  value: string | number | boolean | Record<string, unknown>;
  numericValue: number | null;
  unit: string | null;
  currency: string | null;
  timeRange: { start: string | null; end: string | null } | null;
  constraintType: 'hard' | 'soft' | 'info' | 'option';
  isAdministrativeDeadline: boolean;
  announcedValue: string | null;
  operationalValue: string | null;
  originalMessageId: string;
  sender: string;
  senderRole: string;
  timestamp: string;
  confidence: number;
  authorityAssessment: AuthorityLevel;
  status: FactStatus;
  relatedConstraints: string[];
  reason: string;
  rawQuote: string;
  supersededByFactId?: string;
  history: FactHistoryEntry[];
}

export interface ConflictRecord {
  id: string;
  timestamp: string;
  classification: ConflictClassification;
  category: FactCategory;
  factKey: string;
  originalFactId: string | null;
  originalInfo: string;
  incomingFactId: string;
  incomingInfo: string;
  selectedInfo: string;
  selectedFactId: string | null;
  source: string;
  reason: string;
  finalStatus: FactStatus;
  requiresHumanVerification: boolean;
}

export interface VenueOption {
  name: string;
  capacity: number;
  cost: number;
  hasGenerator: boolean;
  hasAC: boolean;
  hasWifi: boolean;
  location: string;
  notes: string[];
  meetsConstraints: boolean;
  rejectionReason?: string;
}

export interface VenuePlan {
  selectedVenue: string | null;
  requiredCapacity: number;
  capacityBreakdown: {
    students: number;
    judges: number;
    organizers: number;
    guests: number;
    total: number;
  };
  venueCapacity: number;
  venueCost: number;
  constraintsChecked: string[];
  satisfiedConstraints: string[];
  violatedConstraints: string[];
  candidatesEvaluated: VenueOption[];
  rationale: string;
  updatedFields: string[];
}

export interface ScheduleSlot {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  type: 'opening' | 'build' | 'prayer_break' | 'judging' | 'closing' | 'logistics' | 'other';
  notes: string;
}

export interface AdministrativeDeadline {
  name: string;
  operationalTime: string;
  announcedTime: string | null;
  supersededTimes: string[];
  sourceMessageId: string;
  explanation: string;
}

export interface SchedulePlan {
  eventStartTime: string | null;
  eventEndTime: string | null;
  targetDurationMinutes: number;
  actualDurationMinutes: number;
  slots: ScheduleSlot[];
  administrativeDeadlines: AdministrativeDeadline[];
  prayerBreaksIncluded: string[];
  constraintsSatisfied: string[];
  constraintsViolated: string[];
  rationale: string;
  updatedFields: string[];
}

export interface FoodPlan {
  peopleRequiringFood: number;
  teamCount: number;
  headcountBreakdown: {
    students: number;
    judges: number;
    organizers: number;
    guests: number;
  };
  unitPrice: number;
  deliveryCharge: number;
  orderedQuantity: number;
  totalFoodCost: number;
  mealType: string;
  dietaryRestrictions: string[];
  rejectedOrders: Array<{ quantity: number; reason: string; messageId: string }>;
  constraintsSatisfied: string[];
  constraintsViolated: string[];
  rationale: string;
  updatedFields: string[];
}

export interface JudgingPlan {
  totalTeams: number;
  availableJudges: number;
  maxTeamsPerJudge: number;
  minutesPerTeam: number;
  totalJudgingCapacity: number;
  teamsPerJudgeAssigned: number[];
  availableJudgingMinutes: number;
  requiredMinutesPerJudge: number;
  parallelTracks: number;
  judgingRounds: number;
  honorariumPerJudge: number;
  totalJudgeHonorarium: number;
  constraintsSatisfied: string[];
  constraintsViolated: string[];
  rationale: string;
  updatedFields: string[];
}

export interface BudgetLineItem {
  id: string;
  category: 'venue' | 'food' | 'judges' | 'prizes' | 'printing' | 'internet' | 'other';
  label: string;
  amount: number;
  committed: boolean;
  sourceFactId: string;
  sourceMessageId: string;
  notes: string;
}

export interface BudgetPlan {
  approvedBudget: number;
  currency: string;
  lineItems: BudgetLineItem[];
  totalExpenses: number;
  remainingBudget: number;
  isWithinBudget: boolean;
  overBudgetBy: number;
  supersededExpenses: Array<{ label: string; oldAmount: number; newAmount: number; reason: string }>;
  rationale: string;
  updatedFields: string[];
}

export interface EventPlan {
  version: number;
  generatedAt: string;
  lastUpdatedAt: string;
  venue: VenuePlan;
  schedule: SchedulePlan;
  food: FoodPlan;
  judging: JudgingPlan;
  budget: BudgetPlan;
}

export interface ValidationCheck {
  area: PlanningArea | 'cross_area';
  checkName: string;
  passed: boolean;
  severity: 'pass' | 'fail' | 'warning' | 'unresolved';
  expected: string;
  actual: string;
  details: string;
}

export interface ValidationReport {
  timestamp: string;
  overallStatus: 'VALID' | 'INVALID' | 'IMPOSSIBLE' | 'INCOMPLETE';
  isValid: boolean;
  passedChecks: ValidationCheck[];
  failedChecks: ValidationCheck[];
  warnings: ValidationCheck[];
  unresolvedConstraints: ValidationCheck[];
  impossibleReasons: string[];
}

export interface ImpactRecord {
  id: string;
  timestamp: string;
  triggerType: 'initial_pack' | 'incremental_message' | 'human_resolution';
  messageId: string | null;
  messagePreview: string;
  changedFactKeys: string[];
  affectedAreas: PlanningArea[];
  unaffectedAreas: PlanningArea[];
  aiCallsMade: number;
  modelNamesUsed: string[];
  executionMs: number;
  fieldDiffs: Array<{
    area: PlanningArea;
    field: string;
    previousValue: string;
    newValue: string;
    reason: string;
  }>;
  summary: string;
}

export interface TraceCallEntry {
  callNumber: number;
  runId: string;
  runType: 'initial' | 'incremental' | 'resolution';
  modelName: string;
  provider: 'gemini' | 'local';
  areaTag: AreaTag;
  purpose: string;
  timestamp: string;
  durationMs: number;
  input: {
    systemInstruction: string;
    prompt: string;
    schemaUsed: boolean;
  };
  output: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  tokenUsageAvailable: boolean;
  tokenUsageNote?: string;
  error?: string;
}

export interface TraceSummary {
  totalCalls: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  tokenCountComplete: boolean;
  modelsUsed: string[];
  callsGroupedByArea: Record<AreaTag, number>;
  decisionExplanations: Array<{
    timestamp: string;
    messageId: string;
    status: string;
    classification: string;
    reason: string;
  }>;
}

export interface TraceDocument {
  updatedAt: string;
  calls: TraceCallEntry[];
  summary: TraceSummary;
}

export interface ModelConfig {
  provider: 'gemini' | 'local';
  modelName: string;
  localBaseUrl?: string;
}

export interface WorkspaceState {
  sessionId: string;
  sourceFileName: string | null;
  lastRunAt: string | null;
  lastExecutionMs: number | null;
  modelConfig: ModelConfig;
  messages: ParsedMessage[];
  facts: ExtractedFact[];
  conflicts: ConflictRecord[];
  plan: EventPlan | null;
  validation: ValidationReport | null;
  impacts: ImpactRecord[];
}
