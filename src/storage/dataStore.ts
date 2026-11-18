import fs from 'fs';
import path from 'path';
import type { TraceDocument, WorkspaceState } from '../types/planguard.ts';

const DATA_ROOT = path.resolve(process.cwd(), 'data');
const MESSAGES_DIR = path.join(DATA_ROOT, 'messages');
const PLANS_DIR = path.join(DATA_ROOT, 'plans');
const TRACES_DIR = path.join(DATA_ROOT, 'traces');
const SAMPLES_DIR = path.join(DATA_ROOT, 'samples');

const WORKSPACE_FILE = path.join(PLANS_DIR, 'workspace.json');
const MESSAGES_FILE = path.join(MESSAGES_DIR, 'messages.json');
const PLAN_FILE = path.join(PLANS_DIR, 'latest_plan.json');
const TRACE_FILE = path.join(TRACES_DIR, 'trace.json');

export function ensureDataDirectories(): void {
  for (const dir of [DATA_ROOT, MESSAGES_DIR, PLANS_DIR, TRACES_DIR, SAMPLES_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function createEmptyWorkspace(): WorkspaceState {
  const defaultProvider = (process.env.PLANGUARD_PROVIDER === 'local' ? 'local' : 'gemini') as 'gemini' | 'local';
  const defaultModel =
    defaultProvider === 'local'
      ? (process.env.LOCAL_LLM_MODEL || 'qwen2.5:7b')
      : (process.env.PLANGUARD_MODEL || 'gemini-3.1-flash-lite');

  return {
    sessionId: `pg-${Date.now()}`,
    sourceFileName: null,
    lastRunAt: null,
    lastExecutionMs: null,
    modelConfig: {
      provider: defaultProvider,
      modelName: defaultModel,
      localBaseUrl: process.env.LOCAL_LLM_BASE_URL || '',
    },
    messages: [],
    facts: [],
    conflicts: [],
    plan: null,
    validation: null,
    impacts: [],
  };
}

export function createEmptyTrace(): TraceDocument {
  return {
    updatedAt: new Date().toISOString(),
    calls: [],
    summary: {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      tokenCountComplete: true,
      modelsUsed: [],
      callsGroupedByArea: {
        reading: 0,
        venue: 0,
        schedule: 0,
        food: 0,
        judging: 0,
        budget: 0,
      },
      decisionExplanations: [],
    },
  };
}

export function loadWorkspace(): WorkspaceState {
  ensureDataDirectories();
  if (!fs.existsSync(WORKSPACE_FILE)) {
    const empty = createEmptyWorkspace();
    saveWorkspace(empty);
    return empty;
  }
  try {
    const raw = fs.readFileSync(WORKSPACE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as WorkspaceState;
    if (!parsed.modelConfig) {
      parsed.modelConfig = createEmptyWorkspace().modelConfig;
    }
    return parsed;
  } catch {
    const empty = createEmptyWorkspace();
    saveWorkspace(empty);
    return empty;
  }
}

export function saveWorkspace(state: WorkspaceState): void {
  ensureDataDirectories();
  fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(state.messages, null, 2), 'utf-8');
  if (state.plan) {
    fs.writeFileSync(
      PLAN_FILE,
      JSON.stringify(
        {
          plan: state.plan,
          validation: state.validation,
          facts: state.facts,
          conflicts: state.conflicts,
          impacts: state.impacts,
        },
        null,
        2,
      ),
      'utf-8',
    );
  }
}

export function loadTraceDocument(): TraceDocument {
  ensureDataDirectories();
  if (!fs.existsSync(TRACE_FILE)) {
    const empty = createEmptyTrace();
    saveTraceDocument(empty);
    return empty;
  }
  try {
    const raw = fs.readFileSync(TRACE_FILE, 'utf-8');
    return JSON.parse(raw) as TraceDocument;
  } catch {
    const empty = createEmptyTrace();
    saveTraceDocument(empty);
    return empty;
  }
}

export function saveTraceDocument(doc: TraceDocument): void {
  ensureDataDirectories();
  fs.writeFileSync(TRACE_FILE, JSON.stringify(doc, null, 2), 'utf-8');
}

export function resetAllData(preserveModelConfig?: WorkspaceState['modelConfig']): WorkspaceState {
  ensureDataDirectories();
  const fresh = createEmptyWorkspace();
  if (preserveModelConfig) {
    fresh.modelConfig = preserveModelConfig;
  }
  saveWorkspace(fresh);
  if (fs.existsSync(PLAN_FILE)) {
    fs.unlinkSync(PLAN_FILE);
  }
  saveTraceDocument(createEmptyTrace());
  return fresh;
}

export function listSamplePacks(): Array<{ id: string; filename: string; title: string; bytes: number }> {
  ensureDataDirectories();
  const files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.txt')).sort();
  return files.map((filename) => {
    const fullPath = path.join(SAMPLES_DIR, filename);
    const stat = fs.statSync(fullPath);
    const firstLine = fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/).find((l) => l.trim().length > 0) || filename;
    const title = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '').trim() : filename;
    return {
      id: filename.replace(/\.txt$/, ''),
      filename,
      title,
      bytes: stat.size,
    };
  });
}

export function readSamplePack(filename: string): { filename: string; content: string } {
  ensureDataDirectories();
  const safeName = path.basename(filename);
  const fullPath = path.join(SAMPLES_DIR, safeName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Sample pack not found: ${safeName}`);
  }
  return {
    filename: safeName,
    content: fs.readFileSync(fullPath, 'utf-8'),
  };
}
