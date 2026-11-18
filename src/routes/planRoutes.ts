import express from 'express';
import { SUPPORTED_MODELS } from '../ai/modelProvider.ts';
import { loadWorkspace, saveWorkspace } from '../storage/dataStore.ts';
import { getTrace } from '../trace/traceManager.ts';
import { resolveFactManually } from '../updates/updateManager.ts';
import type { ModelConfig } from '../types/planguard.ts';

export const planRouter = express.Router();

planRouter.get('/state', (_req, res) => {
  try {
    const state = loadWorkspace();
    const trace = getTrace();
    res.json({
      state,
      trace,
      supportedModels: SUPPORTED_MODELS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load workspace state';
    res.status(500).json({ error: message });
  }
});

planRouter.post('/config/model', (req, res) => {
  try {
    const body = req.body as Partial<ModelConfig>;
    const state = loadWorkspace();

    if (body.provider !== 'local' && body.provider !== 'gemini') {
      res.status(400).json({ error: 'Provider must be "gemini" or "local".' });
      return;
    }
    const provider = body.provider;
    const modelName =
      typeof body.modelName === 'string' && body.modelName.trim()
        ? body.modelName.trim()
        : provider === 'local'
          ? process.env.LOCAL_LLM_MODEL || 'qwen2.5:7b'
          : process.env.PLANGUARD_MODEL || SUPPORTED_MODELS[0].id;

    state.modelConfig = {
      provider,
      modelName,
      localBaseUrl:
        typeof body.localBaseUrl === 'string' && body.localBaseUrl.trim()
          ? body.localBaseUrl.trim()
          : state.modelConfig.localBaseUrl || process.env.LOCAL_LLM_BASE_URL || '',
    };
    saveWorkspace(state);
    res.json({ modelConfig: state.modelConfig });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update model configuration';
    res.status(500).json({ error: message });
  }
});

planRouter.post('/facts/:id/resolve', async (req, res) => {
  try {
    const { decision, note } = req.body as { decision?: 'confirm' | 'reject'; note?: string };
    if (decision !== 'confirm' && decision !== 'reject') {
      res.status(400).json({ error: 'Decision must be "confirm" or "reject".' });
      return;
    }
    const state = await resolveFactManually({
      factId: req.params.id,
      decision,
      note,
    });
    const trace = getTrace();
    res.json({ state, trace });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resolve fact';
    res.status(500).json({ error: message });
  }
});

planRouter.get('/export/:type', (req, res) => {
  try {
    const state = loadWorkspace();
    const trace = getTrace();
    const type = req.params.type;

    let payload: unknown;
    let filename: string;

    switch (type) {
      case 'plan':
        payload = {
          exportedAt: new Date().toISOString(),
          sourceFileName: state.sourceFileName,
          plan: state.plan,
        };
        filename = 'planguard-event-plan.json';
        break;
      case 'trace':
        payload = trace;
        filename = 'planguard-model-trace.json';
        break;
      case 'validation':
        payload = {
          exportedAt: new Date().toISOString(),
          validation: state.validation,
        };
        filename = 'planguard-validation-report.json';
        break;
      case 'history':
        payload = {
          exportedAt: new Date().toISOString(),
          sourceFileName: state.sourceFileName,
          messages: state.messages,
          facts: state.facts,
          conflicts: state.conflicts,
          impacts: state.impacts,
        };
        filename = 'planguard-message-decision-history.json';
        break;
      default:
        res.status(400).json({ error: `Unknown export type: ${type}` });
        return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate export';
    res.status(500).json({ error: message });
  }
});
