import express from 'express';
import { listSamplePacks, readSamplePack, resetAllData, loadWorkspace } from '../storage/dataStore.ts';
import { processIncrementalMessage, runInitialMessagePack } from '../updates/updateManager.ts';
import { getTrace } from '../trace/traceManager.ts';
import type { MessageSourceType } from '../types/planguard.ts';

export const messageRouter = express.Router();

messageRouter.post('/upload', async (req, res) => {
  try {
    let filename = 'uploaded_messages.txt';
    let content = '';

    if (typeof req.body === 'string') {
      content = req.body;
    } else if (req.body && typeof req.body === 'object') {
      filename = typeof req.body.filename === 'string' && req.body.filename.trim() ? req.body.filename.trim() : filename;
      content = typeof req.body.content === 'string' ? req.body.content : '';
    }

    if (!content.trim()) {
      res.status(400).json({ error: 'Message pack text is empty. Please upload a valid .txt file.' });
      return;
    }

    const state = await runInitialMessagePack({ rawText: content, filename });
    const trace = getTrace();
    res.json({ state, trace });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process message pack';
    res.status(500).json({ error: message });
  }
});

messageRouter.post('/add', async (req, res) => {
  try {
    const body = req.body as { text?: string; sender?: string; sourceType?: MessageSourceType };
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'Message text is required.' });
      return;
    }

    const sourceType: MessageSourceType =
      body.sourceType === 'external_authoritative_clarification'
        ? 'external_authoritative_clarification'
        : 'incremental_message';

    const { state, impact } = await processIncrementalMessage({
      rawText: text,
      senderOverride: typeof body.sender === 'string' ? body.sender : undefined,
      sourceType,
    });
    const trace = getTrace();
    res.json({ state, impact, trace });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process incremental message';
    res.status(500).json({ error: message });
  }
});

messageRouter.get('/samples', (_req, res) => {
  try {
    const samples = listSamplePacks();
    res.json({ samples });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list sample packs';
    res.status(500).json({ error: message });
  }
});

messageRouter.post('/load-sample', async (req, res) => {
  try {
    const { filename } = req.body as { filename?: string };
    if (!filename) {
      res.status(400).json({ error: 'Sample filename is required.' });
      return;
    }
    const { filename: safeName, content } = readSamplePack(filename);
    const state = await runInitialMessagePack({ rawText: content, filename: safeName });
    const trace = getTrace();
    res.json({ state, trace });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load sample pack';
    res.status(500).json({ error: message });
  }
});

messageRouter.post('/reset', (_req, res) => {
  try {
    const current = loadWorkspace();
    const state = resetAllData(current.modelConfig);
    const trace = getTrace();
    res.json({ state, trace });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reset workspace';
    res.status(500).json({ error: message });
  }
});
