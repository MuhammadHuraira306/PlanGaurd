function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(val, currency = 'PKR') {
  return typeof val === 'number' ? `${currency} ${val.toLocaleString()}` : '—';
}

function statusClass(status) {
  const s = String(status || '').toLowerCase();
  return `state-${s}`;
}

export function renderOverviewSection(container, state, trace, samples, handlers) {
  const msgs = state.messages || [];
  const plan = state.plan;
  const val = state.validation;

  const accepted = msgs.filter((m) => m.processingStatus === 'accepted' || m.processingStatus === 'partially_accepted').length;
  const rejected = msgs.filter((m) => m.processingStatus === 'rejected').length;
  const conflicting = msgs.filter((m) => m.processingStatus === 'conflicting' || m.processingStatus === 'unverified').length;

  const currency = plan?.budget?.currency || 'PKR';

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">PlanGUARD Event Operations</h1>
        <p class="section-subtitle">
          Constraint-aware hackathon planning workspace. Upload an unstructured .txt message pack to extract facts, resolve contradictions, and build a validated 4-hour plan.
        </p>
      </div>
      <div class="btn-row">
        ${
          state.plan
            ? `<button id="overview-reset-btn" class="btn btn-danger" type="button">Reset Workspace</button>`
            : ''
        }
      </div>
    </div>

    <div class="upload-grid">
      <div class="panel" style="margin-bottom:0;">
        <div class="panel-header">
          <h2 class="panel-title">Ingest Message Pack (.txt)</h2>
          <span class="meta-line">English · Roman Urdu · Emails · WhatsApp</span>
        </div>
        <div class="dropzone" id="overview-dropzone">
          <p class="dropzone-title">Drop a .txt message pack here or click to browse</p>
          <p class="dropzone-desc">Reads messages verbatim without hardcoded assumptions and logs every model call.</p>
          <div class="btn-row" style="justify-content:center;">
            <button id="overview-browse-btn" class="btn btn-primary" type="button">Choose .txt File</button>
            ${
              samples.length > 0
                ? `<select id="sample-pack-select" class="model-select" aria-label="Select synthetic test pack">
                    <option value="">Load synthetic test pack...</option>
                    ${samples.map((s) => `<option value="${esc(s.filename)}">${esc(s.title)}</option>`).join('')}
                  </select>`
                : ''
            }
          </div>
        </div>
      </div>

      <div class="panel" style="margin-bottom:0;">
        <div class="panel-header">
          <h2 class="panel-title">Paste Raw Message Pack</h2>
          <span class="meta-line">Direct text ingestion</span>
        </div>
        <div class="form-field">
          <textarea id="paste-pack-input" class="text-area" placeholder="Paste raw email, WhatsApp, or notice pack here..."></textarea>
        </div>
        <div class="btn-row">
          <button id="paste-pack-submit" class="btn btn-secondary" type="button">Process Pasted Pack</button>
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-tile">
        <div class="kpi-label">Messages Processed</div>
        <div class="kpi-value">${msgs.length}</div>
        <div class="kpi-detail">${accepted} accepted · ${rejected} rejected · ${conflicting} conflicting</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Approved Budget</div>
        <div class="kpi-value">${plan ? fmtMoney(plan.budget.approvedBudget, currency) : '—'}</div>
        <div class="kpi-detail">${plan ? `Spent: ${fmtMoney(plan.budget.totalExpenses, currency)}` : 'Awaiting pack'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Remaining Balance</div>
        <div class="kpi-value ${plan && !plan.budget.isWithinBudget ? 'state-fail' : ''}">${plan ? fmtMoney(plan.budget.remainingBudget, currency) : '—'}</div>
        <div class="kpi-detail">${plan ? (plan.budget.isWithinBudget ? 'Within approved limit' : `Over by ${fmtMoney(plan.budget.overBudgetBy, currency)}`) : 'Awaiting pack'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Selected Venue</div>
        <div class="kpi-value" style="font-size:17px;font-family:var(--font-display);">${plan?.venue?.selectedVenue ? esc(plan.venue.selectedVenue) : '—'}</div>
        <div class="kpi-detail">${plan ? `Cap ${plan.venue.venueCapacity} / Req ${plan.venue.requiredCapacity}` : 'Awaiting pack'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Food Coverage</div>
        <div class="kpi-value">${plan ? `${plan.food.orderedQuantity} / ${plan.food.peopleRequiringFood}` : '—'}</div>
        <div class="kpi-detail">${plan ? `${plan.food.teamCount} teams (${plan.food.peopleRequiringFood} people)` : 'Awaiting pack'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Judging Capacity</div>
        <div class="kpi-value">${plan ? `${plan.judging.totalJudgingCapacity} / ${plan.judging.totalTeams}` : '—'}</div>
        <div class="kpi-detail">${plan ? `${plan.judging.availableJudges} judges · ${plan.judging.requiredMinutesPerJudge}m/judge` : 'Awaiting pack'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Overall Plan Validity</div>
        <div class="kpi-value ${val ? statusClass(val.overallStatus) : ''}">${val ? esc(val.overallStatus) : '—'}</div>
        <div class="kpi-detail">${val ? `${val.passedChecks.length} passed · ${val.failedChecks.length} failed` : 'No validation run'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Model Trace Efficiency</div>
        <div class="kpi-value">${trace?.summary?.totalCalls ?? 0} calls</div>
        <div class="kpi-detail">${typeof trace?.summary?.totalTokens === 'number' ? `${trace.summary.totalTokens.toLocaleString()} total tokens` : 'Tokens unavailable'}</div>
      </div>
    </div>

    ${
      plan
        ? `
      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Add Incremental Message</h2>
          <span class="meta-line">Updates only affected planning areas · Max 5 model calls</span>
        </div>
        <div class="upload-grid" style="margin-bottom:0;grid-template-columns:1fr 2fr;">
          <div>
            <div class="form-field">
              <label class="form-label" for="inc-sender">Sender (optional)</label>
              <input id="inc-sender" class="text-input" type="text" placeholder="e.g., Finance Head / Caterer" />
            </div>
            <div class="form-field">
              <label class="form-label" for="inc-source-type">Message Provenance</label>
              <select id="inc-source-type" class="select-input">
                <option value="incremental_message">Incoming Message (Auto-Evaluate)</option>
                <option value="external_authoritative_clarification">External Authoritative Clarification</option>
              </select>
            </div>
            <div class="btn-row">
              <button class="btn btn-secondary btn-sm" id="prefill-practice-1" type="button">Try Practice Msg 1</button>
              <button class="btn btn-secondary btn-sm" id="prefill-practice-2" type="button">Try Practice Msg 2</button>
            </div>
          </div>
          <div>
            <div class="form-field">
              <label class="form-label" for="inc-message-text">New Message Text</label>
              <textarea id="inc-message-text" class="text-area" placeholder="Enter a single new email, WhatsApp message, Roman Urdu correction, or constraint change..."></textarea>
            </div>
            <button id="inc-submit-btn" class="btn btn-primary" type="button">Process Incremental Update</button>
          </div>
        </div>
      </div>
    `
        : ''
    }
  `;

  const dropzone = container.querySelector('#overview-dropzone');
  const browseBtn = container.querySelector('#overview-browse-btn');
  const sampleSelect = container.querySelector('#sample-pack-select');
  const pasteBtn = container.querySelector('#paste-pack-submit');
  const resetBtn = container.querySelector('#overview-reset-btn');
  const incBtn = container.querySelector('#inc-submit-btn');
  const p1 = container.querySelector('#prefill-practice-1');
  const p2 = container.querySelector('#prefill-practice-2');

  browseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.triggerFilePicker();
  });

  dropzone?.addEventListener('click', () => handlers.triggerFilePicker());
  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handlers.onFileSelected(file);
  });

  sampleSelect?.addEventListener('change', (e) => {
    const valName = e.target.value;
    if (valName) handlers.onLoadSample(valName);
  });

  pasteBtn?.addEventListener('click', () => {
    const txt = container.querySelector('#paste-pack-input')?.value || '';
    if (txt.trim()) handlers.onUploadRawText('pasted_pack.txt', txt);
  });

  resetBtn?.addEventListener('click', () => handlers.onReset());

  p1?.addEventListener('click', () => {
    container.querySelector('#inc-sender').value = 'Finance';
    container.querySelector('#inc-message-text').value =
      'Finance here. The printing bill came in at Rs 15,000, not Rs 10,000.';
  });

  p2?.addEventListener('click', () => {
    container.querySelector('#inc-sender').value = 'Caterer';
    container.querySelector('#inc-message-text').value =
      'Caterer: I have rounded your order down to 100 boxes to keep the cost low.';
  });

  incBtn?.addEventListener('click', () => {
    const text = container.querySelector('#inc-message-text')?.value || '';
    const sender = container.querySelector('#inc-sender')?.value || '';
    const sourceType = container.querySelector('#inc-source-type')?.value || 'incremental_message';
    if (text.trim()) {
      handlers.onAddIncremental({ text, sender, sourceType });
    }
  });
}

export function renderMessagesSection(container, state, handlers) {
  const msgs = state.messages || [];

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Message Pack &amp; Ingestion Log</h1>
        <p class="section-subtitle">
          Original verbatim messages with extracted sender, channel, language, authority level, and acceptance/rejection explanation.
        </p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">Add New Message to Context</h2>
      </div>
      <div class="form-field">
        <textarea id="msg-tab-input" class="text-area" placeholder="Paste a new incoming message (English or Roman Urdu)..."></textarea>
      </div>
      <div class="btn-row">
        <input id="msg-tab-sender" class="text-input" style="max-width:240px;" type="text" placeholder="Optional sender override" />
        <select id="msg-tab-source" class="select-input" style="max-width:280px;">
          <option value="incremental_message">Incoming Message</option>
          <option value="external_authoritative_clarification">External Authoritative Clarification</option>
        </select>
        <button id="msg-tab-submit" class="btn btn-primary" type="button">Process Message</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">Ingested Messages (${msgs.length})</h2>
      </div>
      ${
        msgs.length === 0
          ? `<div class="empty-state"><h3>No messages ingested</h3><p>Upload a .txt file from Overview to inspect parsed messages.</p></div>`
          : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Sender &amp; Authority</th>
                <th>Original Message</th>
                <th>Status</th>
                <th>Decision Explanation</th>
              </tr>
            </thead>
            <tbody>
              ${msgs
                .map(
                  (m) => `
                <tr>
                  <td class="tabular-nums">${esc(m.id)}</td>
                  <td>
                    <div style="font-weight:600;color:var(--text-primary);">${esc(m.sender)}</div>
                    <div class="meta-line">
                      <span>${esc(m.senderRole)}</span>
                      <span aria-hidden="true">·</span>
                      <span>${esc(m.authorityLevel)}</span>
                      <span aria-hidden="true">·</span>
                      <span>${esc(m.channel)}</span>
                    </div>
                    <div class="meta-line">
                      <span>${esc(m.timestamp)}</span>
                      <span aria-hidden="true">·</span>
                      <span>${esc(m.language)}</span>
                      ${m.uncertainBoundary ? '<span aria-hidden="true">·</span><span class="state-warning">uncertain boundary</span>' : ''}
                    </div>
                  </td>
                  <td style="max-width:420px;white-space:pre-wrap;">${esc(m.rawText)}</td>
                  <td><span class="state-text ${statusClass(m.processingStatus)}">${esc(m.processingStatus)}</span></td>
                  <td style="max-width:300px;">${esc(m.decisionReason)}</td>
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

  container.querySelector('#msg-tab-submit')?.addEventListener('click', () => {
    const text = container.querySelector('#msg-tab-input')?.value || '';
    const sender = container.querySelector('#msg-tab-sender')?.value || '';
    const sourceType = container.querySelector('#msg-tab-source')?.value || 'incremental_message';
    if (text.trim()) handlers.onAddIncremental({ text, sender, sourceType });
  });
}

let activeFactFilter = 'all';

export function renderFactsSection(container, state, handlers) {
  const facts = state.facts || [];
  const filtered =
    activeFactFilter === 'all'
      ? facts
      : activeFactFilter === 'active'
        ? facts.filter((f) => f.status === 'Confirmed' || f.status === 'Accepted')
        : facts.filter((f) => f.status.toLowerCase() === activeFactFilter);

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Extracted Facts &amp; Lifecycle</h1>
        <p class="section-subtitle">
          Structured knowledge store preserving every extracted constraint, source authority, status transition history, and human verification actions.
        </p>
      </div>
    </div>

    <div class="filter-bar">
      <div class="segmented-group" role="tablist">
        ${['all', 'active', 'confirmed', 'superseded', 'rejected', 'conflicting', 'unverified', 'outdated', 'irrelevant']
          .map(
            (key) => `
          <button class="seg-btn ${activeFactFilter === key ? 'active' : ''}" data-fact-filter="${key}" type="button">
            ${key.charAt(0).toUpperCase() + key.slice(1)}
          </button>
        `,
          )
          .join('')}
      </div>
      <span class="meta-line tabular-nums">Showing ${filtered.length} of ${facts.length} facts</span>
    </div>

    <div class="panel">
      ${
        filtered.length === 0
          ? `<div class="empty-state"><h3>No facts match this filter</h3><p>Upload a message pack or switch the status filter above.</p></div>`
          : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fact ID &amp; Key</th>
                <th>Category</th>
                <th>Extracted Value</th>
                <th>Source</th>
                <th>Status &amp; Reason</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map(
                  (f) => `
                <tr>
                  <td>
                    <div class="tabular-nums" style="color:var(--text-primary);font-weight:600;">${esc(f.id)}</div>
                    <div class="tabular-nums" style="font-size:12px;color:var(--text-muted);">${esc(f.factKey)}</div>
                  </td>
                  <td>${esc(f.category)}</td>
                  <td style="max-width:280px;">
                    <div style="color:var(--text-primary);font-weight:500;">${esc(f.summary)}</div>
                    <div class="tabular-nums" style="font-size:12px;color:var(--emerald);">${esc(
                      typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.operationalValue ?? f.value),
                    )}</div>
                  </td>
                  <td>
                    <div>${esc(f.sender)}</div>
                    <div class="meta-line">
                      <span>${esc(f.originalMessageId)}</span>
                      <span aria-hidden="true">·</span>
                      <span>${esc(f.authorityAssessment)}</span>
                    </div>
                  </td>
                  <td style="max-width:280px;">
                    <span class="state-text ${statusClass(f.status)}">${esc(f.status)}</span>
                    <div style="font-size:12px;margin-top:4px;">${esc(f.reason)}</div>
                  </td>
                  <td>
                    ${
                      f.status === 'Unverified' || f.status === 'Conflicting'
                        ? `<div class="btn-row">
                            <button class="btn btn-primary btn-sm" data-confirm-fact="${esc(f.id)}" type="button">Confirm</button>
                            <button class="btn btn-danger btn-sm" data-reject-fact="${esc(f.id)}" type="button">Reject</button>
                          </div>`
                        : `<span class="meta-line tabular-nums">${f.history?.length || 1} transition(s)</span>`
                    }
                  </td>
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

  container.querySelectorAll('[data-fact-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFactFilter = btn.getAttribute('data-fact-filter') || 'all';
      renderFactsSection(container, state, handlers);
    });
  });

  container.querySelectorAll('[data-confirm-fact]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onResolveFact(btn.getAttribute('data-confirm-fact'), 'confirm'));
  });
  container.querySelectorAll('[data-reject-fact]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onResolveFact(btn.getAttribute('data-reject-fact'), 'reject'));
  });
}

export function renderPlanSection(container, state) {
  const plan = state.plan;
  if (!plan) {
    container.innerHTML = `
      <div class="section-header"><div><h1 class="section-title">Event Plan (5 Areas)</h1></div></div>
      <div class="empty-state"><h3>No event plan generated yet</h3><p>Upload a .txt message pack from Overview to generate the Venue, Schedule, Food, Judging, and Budget plan.</p></div>
    `;
    return;
  }

  const v = plan.venue;
  const s = plan.schedule;
  const f = plan.food;
  const j = plan.judging;
  const b = plan.budget;

  const isUpdated = (list, field) => Array.isArray(list) && list.includes(field);

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Event Plan — Version ${plan.version}</h1>
        <p class="section-subtitle">
          Five constraint-verified planning modules. Fields highlighted in emerald changed during the latest incremental update.
        </p>
      </div>
      <div class="btn-row">
        <a class="btn btn-secondary" href="/api/export/plan" download="planguard-event-plan.json">Download Plan JSON</a>
      </div>
    </div>

    <div class="plan-grid">
      <!-- 1. VENUE -->
      <div class="panel" style="margin-bottom:0;">
        <div class="panel-header">
          <h2 class="panel-title">1. Venue</h2>
          <span class="state-text ${v.selectedVenue ? 'state-confirmed' : 'state-fail'}">${v.selectedVenue ? 'Selected' : 'Unresolved'}</span>
        </div>
        <div class="kv-list">
          <div class="kv-row ${isUpdated(v.updatedFields, 'selectedVenue') ? 'field-updated' : ''}">
            <span class="kv-key">Selected Venue</span>
            <span class="kv-val">${esc(v.selectedVenue || 'None compliant')}</span>
          </div>
          <div class="kv-row ${isUpdated(v.updatedFields, 'requiredCapacity') ? 'field-updated' : ''}">
            <span class="kv-key">Required vs Venue Capacity</span>
            <span class="kv-val tabular-nums">${v.requiredCapacity} req / ${v.venueCapacity} cap</span>
          </div>
          <div class="kv-row ${isUpdated(v.updatedFields, 'venueCost') ? 'field-updated' : ''}">
            <span class="kv-key">Venue Cost</span>
            <span class="kv-val tabular-nums">${fmtMoney(v.venueCost, b.currency)}</span>
          </div>
        </div>
        <p style="font-size:13px;color:var(--text-secondary);margin:14px 0 10px;">${esc(v.rationale)}</p>
        ${
          v.candidatesEvaluated.length > 0
            ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Candidate</th><th class="num-col">Cap</th><th class="num-col">Cost</th><th>Status</th></tr></thead><tbody>
            ${v.candidatesEvaluated
              .map(
                (c) => `<tr><td>${esc(c.name)}</td><td class="num-col">${c.capacity}</td><td class="num-col">${c.cost.toLocaleString()}</td><td><span class="state-text ${c.meetsConstraints ? 'state-confirmed' : 'state-rejected'}">${c.meetsConstraints ? 'Feasible' : esc(c.rejectionReason || 'Rejected')}</span></td></tr>`,
              )
              .join('')}
          </tbody></table></div>`
            : ''
        }
      </div>

      <!-- 3. FOOD -->
      <div class="panel" style="margin-bottom:0;">
        <div class="panel-header">
          <h2 class="panel-title">3. Food &amp; Catering</h2>
          <span class="state-text ${f.orderedQuantity >= f.peopleRequiringFood && f.peopleRequiringFood > 0 ? 'state-confirmed' : 'state-fail'}">
            ${f.orderedQuantity >= f.peopleRequiringFood && f.peopleRequiringFood > 0 ? 'Full Coverage' : 'Insufficient'}
          </span>
        </div>
        <div class="kv-list">
          <div class="kv-row ${isUpdated(f.updatedFields, 'peopleRequiringFood') ? 'field-updated' : ''}">
            <span class="kv-key">People Requiring Food</span>
            <span class="kv-val tabular-nums">${f.peopleRequiringFood} (${f.headcountBreakdown.students} students + ${f.headcountBreakdown.judges} judges + ${f.headcountBreakdown.organizers} org/vol + ${f.headcountBreakdown.guests} guests)</span>
          </div>
          <div class="kv-row ${isUpdated(f.updatedFields, 'orderedQuantity') ? 'field-updated' : ''}">
            <span class="kv-key">Approved Order Quantity</span>
            <span class="kv-val tabular-nums">${f.orderedQuantity} units (${esc(f.mealType)})</span>
          </div>
          <div class="kv-row">
            <span class="kv-key">Unit Price + Delivery</span>
            <span class="kv-val tabular-nums">${fmtMoney(f.unitPrice, b.currency)} + ${fmtMoney(f.deliveryCharge, b.currency)}</span>
          </div>
          <div class="kv-row ${isUpdated(f.updatedFields, 'totalFoodCost') ? 'field-updated' : ''}">
            <span class="kv-key">Total Food Cost</span>
            <span class="kv-val tabular-nums">${fmtMoney(f.totalFoodCost, b.currency)}</span>
          </div>
        </div>
        ${
          f.rejectedOrders.length > 0
            ? `<div class="status-banner error" style="margin:14px 0 0;">
                Rejected insufficient order(s): ${f.rejectedOrders.map((r) => `${r.quantity} boxes (${esc(r.messageId)}): ${esc(r.reason)}`).join(' | ')}
              </div>`
            : ''
        }
      </div>

      <!-- 2. SCHEDULE -->
      <div class="panel plan-panel-full" style="margin-bottom:0;">
        <div class="panel-header">
          <h2 class="panel-title">2. Schedule (${esc(s.eventStartTime)} — ${esc(s.eventEndTime)} · ${s.actualDurationMinutes} min)</h2>
          <span class="state-text ${s.actualDurationMinutes === s.targetDurationMinutes && s.constraintsViolated.length === 0 ? 'state-confirmed' : 'state-fail'}">
            ${s.actualDurationMinutes} / ${s.targetDurationMinutes} min
          </span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Time Window</th>
                <th>Activity</th>
                <th>Type</th>
                <th class="num-col">Duration</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${s.slots
                .map(
                  (slot) => `
                <tr>
                  <td class="tabular-nums" style="color:var(--text-primary);white-space:nowrap;">${esc(slot.startTime)} – ${esc(slot.endTime)}</td>
                  <td style="font-weight:600;color:var(--text-primary);">${esc(slot.title)}</td>
                  <td>${esc(slot.type.replace('_', ' '))}</td>
                  <td class="num-col">${slot.durationMinutes} min</td>
                  <td>${esc(slot.notes)}</td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
        ${
          s.administrativeDeadlines.length > 0
            ? `
          <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border-hairline);">
            <div style="font-weight:600;margin-bottom:8px;">Administrative Deadlines (Separate from 4-Hour Timetable)</div>
            ${s.administrativeDeadlines
              .map(
                (ad) => `
              <div class="kv-row ${isUpdated(s.updatedFields, 'administrativeDeadlines') ? 'field-updated' : ''}">
                <div>
                  <span style="font-weight:600;color:var(--text-primary);text-transform:capitalize;">${esc(ad.name)}</span>
                  <div class="meta-line">
                    ${ad.announcedTime ? `<span>Announced: ${esc(ad.announcedTime)}</span><span aria-hidden="true">·</span>` : ''}
                    ${ad.supersededTimes.length ? `<span>Superseded: ${esc(ad.supersededTimes.join(', '))}</span><span aria-hidden="true">·</span>` : ''}
                    <span>${esc(ad.explanation)}</span>
                  </div>
                </div>
                <span class="kv-val tabular-nums" style="color:var(--emerald);">Operational: ${esc(ad.operationalTime)}</span>
              </div>
            `,
              )
              .join('')}
          </div>
        `
            : ''
        }
      </div>

      <!-- 4. JUDGING -->
      <div class="panel" style="margin-bottom:0;">
        <div class="panel-header">
          <h2 class="panel-title">4. Judging</h2>
          <span class="state-text ${j.constraintsViolated.length === 0 ? 'state-confirmed' : 'state-fail'}">${j.constraintsViolated.length === 0 ? 'Feasible' : 'Constraint Violation'}</span>
        </div>
        <div class="kv-list">
          <div class="kv-row">
            <span class="kv-key">Total Teams</span>
            <span class="kv-val tabular-nums">${j.totalTeams} teams</span>
          </div>
          <div class="kv-row ${isUpdated(j.updatedFields, 'availableJudges') ? 'field-updated' : ''}">
            <span class="kv-key">Judges &amp; Max Load</span>
            <span class="kv-val tabular-nums">${j.availableJudges} judges × max ${j.maxTeamsPerJudge} = ${j.totalJudgingCapacity} capacity</span>
          </div>
          <div class="kv-row">
            <span class="kv-key">Distribution Across Judges</span>
            <span class="kv-val tabular-nums">[${j.teamsPerJudgeAssigned.join(', ')}] teams/judge</span>
          </div>
          <div class="kv-row ${isUpdated(j.updatedFields, 'requiredMinutesPerJudge') ? 'field-updated' : ''}">
            <span class="kv-key">Time Required vs Window</span>
            <span class="kv-val tabular-nums">${j.requiredMinutesPerJudge}m req / ${j.availableJudgingMinutes}m avail (${j.minutesPerTeam}m/team)</span>
          </div>
          <div class="kv-row">
            <span class="kv-key">Judge Honorariums</span>
            <span class="kv-val tabular-nums">${fmtMoney(j.totalJudgeHonorarium, b.currency)}</span>
          </div>
        </div>
      </div>

      <!-- 5. BUDGET -->
      <div class="panel" style="margin-bottom:0;">
        <div class="panel-header">
          <h2 class="panel-title">5. Budget Ledger</h2>
          <span class="state-text ${b.isWithinBudget ? 'state-confirmed' : 'state-fail'}">${b.isWithinBudget ? 'Within Budget' : 'Over Budget'}</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Expense Line</th>
                <th>Source</th>
                <th class="num-col">Amount (${esc(b.currency)})</th>
              </tr>
            </thead>
            <tbody>
              ${b.lineItems
                .map(
                  (item) => `
                <tr>
                  <td>${esc(item.label)}</td>
                  <td class="tabular-nums">${esc(item.sourceMessageId)}</td>
                  <td class="num-col">${item.amount.toLocaleString()}</td>
                </tr>
              `,
                )
                .join('')}
              <tr>
                <td colspan="2" style="font-weight:700;color:var(--text-primary);">Total Expenses</td>
                <td class="num-col ${isUpdated(b.updatedFields, 'totalExpenses') ? 'field-updated' : ''}" style="font-weight:700;color:var(--text-primary);">${b.totalExpenses.toLocaleString()}</td>
              </tr>
              <tr>
                <td colspan="2" style="font-weight:700;color:var(--text-primary);">Approved Budget</td>
                <td class="num-col" style="font-weight:700;">${b.approvedBudget.toLocaleString()}</td>
              </tr>
              <tr>
                <td colspan="2" style="font-weight:700;">Remaining Balance</td>
                <td class="num-col ${b.isWithinBudget ? 'state-confirmed' : 'state-fail'} ${isUpdated(b.updatedFields, 'remainingBudget') ? 'field-updated' : ''}" style="font-weight:700;">${b.remainingBudget.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${
          b.supersededExpenses.length > 0
            ? `<div class="meta-line" style="margin-top:12px;">
                Superseded expenses: ${b.supersededExpenses.map((se) => `${esc(se.label)} (${se.oldAmount.toLocaleString()} → ${se.newAmount.toLocaleString()})`).join(' · ')}
              </div>`
            : ''
        }
      </div>
    </div>
  `;
}

export function renderConflictsSection(container, state, handlers) {
  const conflicts = state.conflicts || [];

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Conflict Resolution &amp; Rejections</h1>
        <p class="section-subtitle">
          Every contradiction, misleading claim, unauthorized instruction, outdated notice, and operational clarification with full decision provenance.
        </p>
      </div>
    </div>

    <div class="panel">
      ${
        conflicts.length === 0
          ? `<div class="empty-state"><h3>No conflicts or overrides recorded</h3><p>When messages contain contradictions, outdated notices, or constraint-violating claims, resolution decisions appear here.</p></div>`
          : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Classification</th>
                <th>Original Info</th>
                <th>Conflicting / Incoming</th>
                <th>Selected Decision</th>
                <th>Source &amp; Reason</th>
                <th>Final Status</th>
              </tr>
            </thead>
            <tbody>
              ${conflicts
                .map(
                  (c) => `
                <tr>
                  <td><strong>${esc(c.classification.replace(/_/g, ' '))}</strong><div class="tabular-nums" style="font-size:12px;color:var(--text-muted);">${esc(c.factKey)}</div></td>
                  <td style="max-width:210px;">${esc(c.originalInfo)}</td>
                  <td style="max-width:210px;">${esc(c.incomingInfo)}</td>
                  <td style="max-width:210px;color:var(--text-primary);font-weight:500;">${esc(c.selectedInfo)}</td>
                  <td style="max-width:280px;">
                    <div style="font-size:12px;color:var(--text-muted);">${esc(c.source)}</div>
                    <div style="margin-top:4px;">${esc(c.reason)}</div>
                  </td>
                  <td>
                    <span class="state-text ${statusClass(c.finalStatus)}">${esc(c.finalStatus)}</span>
                    ${
                      c.requiresHumanVerification
                        ? `<div class="btn-row" style="margin-top:8px;">
                            <button class="btn btn-primary btn-sm" data-confirm-fact="${esc(c.incomingFactId)}" type="button">Accept</button>
                            <button class="btn btn-danger btn-sm" data-reject-fact="${esc(c.incomingFactId)}" type="button">Reject</button>
                          </div>`
                        : ''
                    }
                  </td>
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

  container.querySelectorAll('[data-confirm-fact]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onResolveFact(btn.getAttribute('data-confirm-fact'), 'confirm'));
  });
  container.querySelectorAll('[data-reject-fact]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onResolveFact(btn.getAttribute('data-reject-fact'), 'reject'));
  });
}

export function renderImpactSection(container, state) {
  const impacts = [...(state.impacts || [])].reverse();

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Incremental Impact Analysis</h1>
        <p class="section-subtitle">
          Dependency-graph execution log proving only affected planning areas are recomputed while untouched areas stay preserved within the 5-call limit.
        </p>
      </div>
    </div>

    <div class="panel">
      ${
        impacts.length === 0
          ? `<div class="empty-state"><h3>No updates recorded yet</h3><p>Ingest a message pack and send incremental updates to inspect dependency predictions and field diffs.</p></div>`
          : impacts
              .map(
                (imp) => `
          <div class="panel" style="background-color:var(--bg-elevated);margin-bottom:16px;">
            <div class="panel-header">
              <div>
                <h3 class="panel-title">${esc(imp.triggerType.replace(/_/g, ' '))}${imp.messageId ? ` — ${esc(imp.messageId)}` : ''}</h3>
                <div class="meta-line" style="margin-top:4px;">
                  <span>${esc(new Date(imp.timestamp).toLocaleString())}</span>
                  <span aria-hidden="true">·</span>
                  <span class="tabular-nums">${imp.aiCallsMade} AI call(s)</span>
                  <span aria-hidden="true">·</span>
                  <span class="tabular-nums">${imp.executionMs}ms</span>
                </div>
              </div>
              <span class="state-text ${imp.aiCallsMade <= 5 ? 'state-confirmed' : 'state-warning'}">
                ${imp.triggerType === 'incremental_message' ? `${imp.aiCallsMade}/5 calls` : `${imp.aiCallsMade} calls`}
              </span>
            </div>
            <p style="margin:0 0 12px;color:var(--text-primary);">${esc(imp.summary)}</p>
            <div class="kv-list">
              <div class="kv-row">
                <span class="kv-key">Trigger Preview</span>
                <span class="kv-val" style="font-weight:400;max-width:65%;">${esc(imp.messagePreview)}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">Changed Fact Keys</span>
                <span class="kv-val tabular-nums">${imp.changedFactKeys.length ? esc(imp.changedFactKeys.join(', ')) : 'None'}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">Affected Areas Updated</span>
                <span class="kv-val state-confirmed">${imp.affectedAreas.length ? esc(imp.affectedAreas.join(', ')) : 'None (0 areas regenerated)'}</span>
              </div>
              <div class="kv-row">
                <span class="kv-key">Unaffected Areas Preserved</span>
                <span class="kv-val">${imp.unaffectedAreas.length ? esc(imp.unaffectedAreas.join(', ')) : '—'}</span>
              </div>
            </div>
            ${
              imp.fieldDiffs.length > 0
                ? `<div class="table-wrap" style="margin-top:14px;">
                    <table class="data-table">
                      <thead><tr><th>Area</th><th>Field</th><th>Previous</th><th>Updated</th><th>Reason</th></tr></thead>
                      <tbody>
                        ${imp.fieldDiffs
                          .map(
                            (d) => `<tr><td>${esc(d.area)}</td><td>${esc(d.field)}</td><td class="tabular-nums">${esc(d.previousValue)}</td><td class="tabular-nums state-confirmed">${esc(d.newValue)}</td><td>${esc(d.reason)}</td></tr>`,
                          )
                          .join('')}
                      </tbody>
                    </table>
                  </div>`
                : ''
            }
          </div>
        `,
              )
              .join('')
      }
    </div>
  `;
}

export function renderValidationSection(container, state) {
  const val = state.validation;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Deterministic Validation Report</h1>
        <p class="section-subtitle">
          Cross-area mathematical verification across Venue, Schedule, Food, Judging, and Budget. Invalid or impossible constraint combinations are never masked.
        </p>
      </div>
      <div class="btn-row">
        <a class="btn btn-secondary" href="/api/export/validation" download="planguard-validation-report.json">Download Report JSON</a>
      </div>
    </div>

    ${
      !val
        ? `<div class="empty-state"><h3>No validation report available</h3><p>Process a message pack to run deterministic plan validation.</p></div>`
        : `
      <div class="kpi-grid">
        <div class="kpi-tile">
          <div class="kpi-label">Overall Status</div>
          <div class="kpi-value ${statusClass(val.overallStatus)}">${esc(val.overallStatus)}</div>
          <div class="kpi-detail">${val.isValid ? 'All hard constraints passed' : 'Action or resolution required'}</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-label">Passed Checks</div>
          <div class="kpi-value state-pass">${val.passedChecks.length}</div>
          <div class="kpi-detail">Deterministic assertions</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-label">Failed Checks</div>
          <div class="kpi-value ${val.failedChecks.length ? 'state-fail' : ''}">${val.failedChecks.length}</div>
          <div class="kpi-detail">Hard constraint failures</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-label">Warnings / Unresolved</div>
          <div class="kpi-value ${val.unresolvedConstraints.length ? 'state-warning' : ''}">${val.warnings.length} / ${val.unresolvedConstraints.length}</div>
          <div class="kpi-detail">Needs review or missing detail</div>
        </div>
      </div>

      ${
        val.impossibleReasons.length > 0
          ? `<div class="status-banner error" style="margin:0 0 24px;display:block;">
              <strong>Impossible Constraint Combination Detected:</strong>
              <ul style="margin:8px 0 0 18px;">
                ${val.impossibleReasons.map((r) => `<li>${esc(r)}</li>`).join('')}
              </ul>
            </div>`
          : ''
      }

      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">All Verification Checks</h2>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Area</th>
                <th>Check</th>
                <th>Result</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${[...val.failedChecks, ...val.unresolvedConstraints, ...val.warnings, ...val.passedChecks]
                .map(
                  (c) => `
                <tr>
                  <td style="text-transform:capitalize;">${esc(c.area.replace('_', ' '))}</td>
                  <td style="font-weight:600;color:var(--text-primary);">${esc(c.checkName)}</td>
                  <td><span class="state-text ${statusClass(c.severity)}">${esc(c.severity.toUpperCase())}</span></td>
                  <td class="tabular-nums">${esc(c.expected)}</td>
                  <td class="tabular-nums">${esc(c.actual)}</td>
                  <td>${esc(c.details)}</td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
    }
  `;
}
