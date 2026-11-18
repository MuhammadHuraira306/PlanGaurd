export async function apiGetState() {
  const res = await fetch('/api/state');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load workspace state');
  return data;
}

export async function apiListSamples() {
  const res = await fetch('/api/messages/samples');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to list sample packs');
  return data.samples || [];
}

export async function apiUploadPack(filename, content) {
  const res = await fetch('/api/messages/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, content }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to process uploaded message pack');
  return data;
}

export async function apiLoadSample(filename) {
  const res = await fetch('/api/messages/load-sample', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load sample pack');
  return data;
}

export async function apiAddIncrementalMessage(payload) {
  const res = await fetch('/api/messages/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to process incoming message');
  return data;
}

export async function apiResolveFact(factId, decision, note) {
  const res = await fetch(`/api/facts/${encodeURIComponent(factId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, note }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to resolve fact');
  return data;
}

export async function apiUpdateModelConfig(provider, modelName, localBaseUrl = '') {
  const config = { provider, modelName };
  if (localBaseUrl.trim()) config.localBaseUrl = localBaseUrl.trim();
  const res = await fetch('/api/config/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update model configuration');
  return data;
}

export async function apiResetWorkspace() {
  const res = await fetch('/api/messages/reset', {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to reset workspace');
  return data;
}
