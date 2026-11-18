function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtToken(val) {
  return typeof val === 'number' ? val.toLocaleString() : 'Unavailable';
}

export function renderTraceSection(container, trace) {
  const summary = trace?.summary || {
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    tokenCountComplete: true,
    modelsUsed: [],
    callsGroupedByArea: {},
    decisionExplanations: [],
  };
  const calls = trace?.calls || [];

  const areaEntries = Object.entries(summary.callsGroupedByArea || {});

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Model-Call Audit Trace</h1>
        <p class="section-subtitle">
          Every language-model invocation logged sequentially with exact prompt inputs, raw model outputs, and provider-reported token counts.
        </p>
      </div>
      <div class="btn-row">
        <a class="btn btn-secondary" href="/api/export/trace" download="planguard-model-trace.json">Download Trace JSON</a>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-tile">
        <div class="kpi-label">Total Model Calls</div>
        <div class="kpi-value">${summary.totalCalls}</div>
        <div class="kpi-detail">${summary.modelsUsed.length ? esc(summary.modelsUsed.join(', ')) : 'No model invoked yet'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Total Input Tokens</div>
        <div class="kpi-value">${fmtToken(summary.totalInputTokens)}</div>
        <div class="kpi-detail">${summary.tokenCountComplete ? 'Provider-verified' : 'Partial / unavailable from provider'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Total Output Tokens</div>
        <div class="kpi-value">${fmtToken(summary.totalOutputTokens)}</div>
        <div class="kpi-detail">${summary.tokenCountComplete ? 'Provider-verified' : 'Partial / unavailable from provider'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value">${fmtToken(summary.totalTokens)}</div>
        <div class="kpi-detail">
          ${areaEntries.map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">Model Invocation Log (${calls.length})</h2>
        <span class="meta-line">Click any call to inspect exact prompt &amp; response payloads</span>
      </div>
      ${
        calls.length === 0
          ? `<div class="empty-state"><h3>No model calls recorded yet</h3><p>Upload a .txt message pack or add a message to inspect audited model calls.</p></div>`
          : calls
              .map(
                (c) => `
          <div class="trace-item" data-call="${c.callNumber}">
            <button class="trace-summary-btn" type="button" data-toggle-trace="${c.callNumber}">
              <div>
                <div style="font-weight:600;">Call #${c.callNumber} — ${esc(c.purpose)}</div>
                <div class="meta-line" style="margin-top:4px;">
                  <span>Area: <strong>${esc(c.areaTag)}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>Model: <span class="tabular-nums">${esc(c.modelName)}</span></span>
                  <span aria-hidden="true">·</span>
                  <span>Run: ${esc(c.runType)}</span>
                  <span aria-hidden="true">·</span>
                  <span class="tabular-nums">${c.durationMs}ms</span>
                </div>
              </div>
              <div class="num-col" style="font-size:12px;">
                <div>${c.tokenUsageAvailable ? `${fmtToken(c.totalTokens)} tokens` : 'Tokens: Unavailable'}</div>
                <div style="color:var(--text-muted);">${c.tokenUsageAvailable ? `${fmtToken(c.inputTokens)} in / ${fmtToken(c.outputTokens)} out` : esc(c.tokenUsageNote || '')}</div>
              </div>
            </button>
            <div class="trace-body hidden" id="trace-body-${c.callNumber}">
              <div class="meta-line" style="margin: 12px 0;">
                <span>Timestamp: <span class="tabular-nums">${esc(c.timestamp)}</span></span>
                <span aria-hidden="true">·</span>
                <span>Provider: ${esc(c.provider)}</span>
                <span aria-hidden="true">·</span>
                <span>Structured Schema: ${c.input?.schemaUsed ? 'Yes' : 'No'}</span>
              </div>
              ${c.error ? `<div class="status-banner error" style="margin:0 0 12px;">Error: ${esc(c.error)}</div>` : ''}
              <div class="form-field">
                <div class="form-label">System Instruction</div>
                <pre class="code-block">${esc(c.input?.systemInstruction || '')}</pre>
              </div>
              <div class="form-field">
                <div class="form-label">Exact Prompt Input</div>
                <pre class="code-block">${esc(c.input?.prompt || '')}</pre>
              </div>
              <div class="form-field">
                <div class="form-label">Exact Model Output</div>
                <pre class="code-block">${esc(c.output || '(empty)')}</pre>
              </div>
            </div>
          </div>
        `,
              )
              .join('')
      }
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">Rejected Messages &amp; Conflict Explanations in Trace (${(summary.decisionExplanations || []).length})</h2>
      </div>
      ${
        (summary.decisionExplanations || []).length === 0
          ? `<p style="color:var(--text-muted);margin:0;">No conflict or rejection explanations logged yet.</p>`
          : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Message</th>
                <th>Classification</th>
                <th>Final Status</th>
                <th>Explanation</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${summary.decisionExplanations
                .map(
                  (d) => `
                <tr>
                  <td class="tabular-nums">${esc(d.messageId)}</td>
                  <td>${esc(d.classification)}</td>
                  <td><span class="state-text state-${esc(String(d.status).toLowerCase())}">${esc(d.status)}</span></td>
                  <td>${esc(d.reason)}</td>
                  <td class="tabular-nums">${esc(new Date(d.timestamp).toLocaleTimeString())}</td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
    </div>
  `;

  container.querySelectorAll('[data-toggle-trace]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-toggle-trace');
      const body = container.querySelector(`#trace-body-${id}`);
      if (body) body.classList.toggle('hidden');
    });
  });
}
