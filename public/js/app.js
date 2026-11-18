import {
  apiAddIncrementalMessage,
  apiGetState,
  apiListSamples,
  apiLoadSample,
  apiResetWorkspace,
  apiResolveFact,
  apiUpdateModelConfig,
  apiUploadPack,
} from './api.js';
import {
  renderConflictsSection,
  renderFactsSection,
  renderImpactSection,
  renderMessagesSection,
  renderOverviewSection,
  renderPlanSection,
  renderValidationSection,
} from './dashboard.js';
import { renderTraceSection } from './trace.js';

const appState = {
  activeSection: 'overview',
  workspace: null,
  trace: null,
  samples: [],
  busy: false,
};

const bannerEl = document.getElementById('status-banner');
const sourceLabelEl = document.getElementById('active-source-label');
const modelSelectEl = document.getElementById('model-select');
const fileInputEl = document.getElementById('hidden-file-input');
const sidebarEl = document.getElementById('sidebar');

function showBanner(type, text) {
  bannerEl.className = `status-banner ${type}`;
  bannerEl.innerHTML = `<span>${text}</span>${
    type !== 'loading' ? '<button class="btn btn-secondary btn-sm" id="dismiss-banner-btn" type="button">Dismiss</button>' : ''
  }`;
  bannerEl.classList.remove('hidden');
  document.getElementById('dismiss-banner-btn')?.addEventListener('click', () => {
    bannerEl.classList.add('hidden');
  });
}

function hideBanner() {
  bannerEl.classList.add('hidden');
}

function setActiveSection(section) {
  appState.activeSection = section;
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-section') === section);
  });
  document.querySelectorAll('.view-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `section-${section}`);
  });
  sidebarEl.classList.remove('open');
}

function updateCountsAndHeader() {
  const ws = appState.workspace;
  const tr = appState.trace;
  if (!ws) return;

  document.getElementById('nav-count-messages').textContent = String(ws.messages?.length || 0);
  document.getElementById('nav-count-facts').textContent = String(ws.facts?.length || 0);
  document.getElementById('nav-count-conflicts').textContent = String(ws.conflicts?.length || 0);
  document.getElementById('nav-count-impact').textContent = String(ws.impacts?.length || 0);
  document.getElementById('nav-count-trace').textContent = String(tr?.summary?.totalCalls || 0);

  sourceLabelEl.textContent = ws.sourceFileName
    ? `${ws.sourceFileName} (Plan v${ws.plan?.version ?? 0})`
    : 'No message pack loaded';

  if (ws.modelConfig) {
    const combined = `${ws.modelConfig.provider}:${ws.modelConfig.modelName}`;
    const hasOption = Array.from(modelSelectEl.options).some((o) => o.value === combined);
    if (!hasOption) {
      const opt = document.createElement('option');
      opt.value = combined;
      opt.textContent = `${ws.modelConfig.modelName} (${ws.modelConfig.provider})`;
      modelSelectEl.appendChild(opt);
    }
    modelSelectEl.value = combined;
  }
}

const handlers = {
  triggerFilePicker: () => fileInputEl.click(),
  onFileSelected: async (file) => {
    const content = await file.text();
    await handlers.onUploadRawText(file.name, content);
  },
  onUploadRawText: async (filename, content) => {
    if (appState.busy) return;
    appState.busy = true;
    showBanner('loading', `Processing "${filename}" through PlanGUARD agents...`);
    try {
      const data = await apiUploadPack(filename, content);
      appState.workspace = data.state;
      appState.trace = data.trace;
      renderAll();
      showBanner(
        'success',
        `Processed ${data.state.messages.length} messages in ${data.state.lastExecutionMs}ms. Plan status: ${data.state.validation?.overallStatus}.`,
      );
    } catch (err) {
      showBanner('error', err.message || 'Failed to process message pack');
    } finally {
      appState.busy = false;
    }
  },
  onLoadSample: async (filename) => {
    if (appState.busy) return;
    appState.busy = true;
    showBanner('loading', `Ingesting synthetic test pack "${filename}"...`);
    try {
      const data = await apiLoadSample(filename);
      appState.workspace = data.state;
      appState.trace = data.trace;
      renderAll();
      showBanner(
        'success',
        `Loaded "${filename}" (${data.state.messages.length} messages) in ${data.state.lastExecutionMs}ms. Validation: ${data.state.validation?.overallStatus}.`,
      );
    } catch (err) {
      showBanner('error', err.message || 'Failed to load sample pack');
    } finally {
      appState.busy = false;
    }
  },
  onAddIncremental: async (payload) => {
    if (appState.busy) return;
    appState.busy = true;
    showBanner('loading', 'Evaluating incremental message and predicting affected areas...');
    try {
      const data = await apiAddIncrementalMessage(payload);
      appState.workspace = data.state;
      appState.trace = data.trace;
      renderAll();
      showBanner('success', data.impact?.summary || 'Incremental update complete.');
    } catch (err) {
      showBanner('error', err.message || 'Failed to process incremental message');
    } finally {
      appState.busy = false;
    }
  },
  onResolveFact: async (factId, decision) => {
    if (appState.busy) return;
    appState.busy = true;
    showBanner('loading', `Applying human verification (${decision}) to ${factId}...`);
    try {
      const data = await apiResolveFact(factId, decision);
      appState.workspace = data.state;
      appState.trace = data.trace;
      renderAll();
      showBanner('success', `Fact ${factId} marked ${decision === 'confirm' ? 'Confirmed' : 'Rejected'} and plan revalidated.`);
    } catch (err) {
      showBanner('error', err.message || 'Failed to resolve fact');
    } finally {
      appState.busy = false;
    }
  },
  onReset: async () => {
    if (appState.busy) return;
    appState.busy = true;
    try {
      const data = await apiResetWorkspace();
      appState.workspace = data.state;
      appState.trace = data.trace;
      renderAll();
      hideBanner();
    } catch (err) {
      showBanner('error', err.message || 'Failed to reset workspace');
    } finally {
      appState.busy = false;
    }
  },
};

function renderAll() {
  if (!appState.workspace) return;
  updateCountsAndHeader();

  renderOverviewSection(
    document.getElementById('section-overview'),
    appState.workspace,
    appState.trace,
    appState.samples,
    handlers,
  );
  renderMessagesSection(document.getElementById('section-messages'), appState.workspace, handlers);
  renderFactsSection(document.getElementById('section-facts'), appState.workspace, handlers);
  renderPlanSection(document.getElementById('section-plan'), appState.workspace);
  renderConflictsSection(document.getElementById('section-conflicts'), appState.workspace, handlers);
  renderImpactSection(document.getElementById('section-impact'), appState.workspace);
  renderTraceSection(document.getElementById('section-trace'), appState.trace);
  renderValidationSection(document.getElementById('section-validation'), appState.workspace);
}

async function init() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.getAttribute('data-section');
      if (section) setActiveSection(section);
    });
  });

  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    sidebarEl.classList.toggle('open');
  });

  document.getElementById('topbar-upload-btn')?.addEventListener('click', () => {
    fileInputEl.click();
  });

  fileInputEl.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await handlers.onFileSelected(file);
      fileInputEl.value = '';
    }
  });

  modelSelectEl.addEventListener('change', async (e) => {
    const [provider, modelName] = e.target.value.split(':');
    try {
      await apiUpdateModelConfig(provider, modelName);
      showBanner('success', `Active model switched to ${modelName}.`);
    } catch (err) {
      showBanner('error', err.message || 'Failed to switch model');
    }
  });

  try {
    const [stateData, samples] = await Promise.all([apiGetState(), apiListSamples()]);
    appState.workspace = stateData.state;
    appState.trace = stateData.trace;
    appState.samples = samples;
    renderAll();
  } catch (err) {
    showBanner('error', err.message || 'Failed to connect to PlanGUARD backend');
  }
}

init();
