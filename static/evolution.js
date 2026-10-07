(() => {
  const base = window.EVOLUTION_SERVICE_URL || 'http://localhost:8001';
  const serviceCard = document.querySelector('.evolution-service');
  const serviceLabel = document.querySelector('#serviceLabel');
  const serviceDetail = document.querySelector('#serviceDetail');
  const result = document.querySelector('#evolutionResult');
  const runStatus = document.querySelector('#runStatus');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const pretty = (value) => escapeHtml(JSON.stringify(value, null, 2));
  const statusClass = (value) => {
    const status = String(value || '').toUpperCase();
    if (/REPAIRED|FOUND|VERIFIED|PASSED/.test(status)) return 'status-found';
    if (/ABSTAIN/.test(status)) return 'status-abstained';
    if (/FAIL|ERROR|UNAVAILABLE|REJECT/.test(status)) return 'status-failed';
    if (/RUNNING|PENDING/.test(status)) return 'status-running';
    return '';
  };
  const badge = (value) => `<span class="status-badge ${statusClass(value)}">${escapeHtml(String(value || 'UNKNOWN').replaceAll('_', ' '))}</span>`;
  async function call(path, options) {
    const response = await fetch(base + path, options);
    let data;
    try { data = await response.json(); } catch { data = { error: `Invalid response (${response.status})` }; }
    if (!response.ok) throw new Error(data.error || `Evolution request failed (${response.status})`);
    return data;
  }
  function loading(message) { result.innerHTML = `<div class="card evolution-loading"><span class="evolution-spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span></div>`; runStatus.hidden = false; runStatus.className = 'status-badge status-running'; runStatus.textContent = 'RUNNING'; }
  function errorState(error) { runStatus.hidden = false; runStatus.className = 'status-badge status-error'; runStatus.textContent = 'FAILED'; result.innerHTML = `<div class="card evolution-panel evolution-error"><h3>Request failed</h3><p class="muted">${escapeHtml(error.message || error)}</p></div>`; }
  function statusFrom(data, fallback) {
    if (data.status) return data.status;
    if (data.failureType) return data.failureType === 'target_found' ? 'FOUND' : data.failureType;
    if (data.choice !== undefined || data.decisionType) return 'DECISION_COMPLETE';
    return fallback;
  }
  function panel(title, body, wide = false) { return `<article class="card evolution-panel${wide ? ' evolution-panel-wide' : ''}"><h3><span class="panel-mark"></span>${title}</h3>${body}</article>`; }
  function jsonPanel(title, value, wide = false) { return panel(title, `<pre class="evolution-json">${pretty(value)}</pre>`, wide); }
  function confidencePanel(data) {
    const decision = data.decision || data;
    const probabilities = decision.probabilities;
    const confidenceValue = decision.confidence ?? decision.rawConfidence;
    const confidence = confidenceValue == null ? Number.NaN : Number(confidenceValue);
    let rows = '';
    if (Array.isArray(probabilities)) rows = probabilities.map((p, i) => {
      const number = Number(p); const percent = Number.isFinite(number) ? Math.max(0, Math.min(100, number * 100)) : 0;
      return `<div class="evolution-metric"><span>Choice ${i + 1}${decision.choice === i ? ' · selected' : ''}</span><b>${Number.isFinite(number) ? number.toFixed(3) : '—'}</b></div><div class="evolution-meter"><i style="width:${percent}%"></i></div>`;
    }).join('');
    const confidenceLabel = data.rawConfidence !== undefined ? 'Raw Confidence' : 'Confidence';
    const confidenceMarkup = Number.isFinite(confidence) ? `<div class="evolution-metric"><span>${confidenceLabel}</span><b>${confidence.toFixed(3)}</b></div><div class="evolution-meter"><i style="width:${Math.max(0, Math.min(100, confidence * 100))}%"></i></div>` : '<p class="muted small">No confidence value returned.</p>';
    return panel('Gemma decision', `${badge(decision.decisionType || decision.type || data.status || 'Decision')}<dl class="evolution-kv" style="margin-top:12px"><dt>Choice</dt><dd>${escapeHtml(decision.choice ?? decision.chosenIndex ?? '—')}</dd><dt>Model</dt><dd>${escapeHtml(decision.model || decision.modelName || '—')}</dd><dt>Evidence ID</dt><dd>${escapeHtml(decision.evidenceId ?? data.evidenceId ?? '—')}</dd></dl>${confidenceMarkup}${rows}`);
  }
  function renderResult(data, kind) {
    const status = statusFrom(data, kind === 'observation' ? 'OBSERVED' : 'COMPLETED');
    runStatus.hidden = false; runStatus.className = `status-badge ${statusClass(status)}`; runStatus.textContent = String(status).replaceAll('_', ' ');
    if (kind === 'phase4') {
      const confidence = (label, value) => `<div class="evolution-metric"><span>${label}</span><b>${value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(3) : 'Unknown'}</b></div>`;
      const summary = `<dl class="evolution-kv"><dt>Decision ID</dt><dd><code>${escapeHtml(data.decisionId || '—')}</code></dd><dt>Risk</dt><dd>${escapeHtml(data.risk || '—')}</dd><dt>Routing</dt><dd>${escapeHtml(data.routingDecision || '—')}</dd><dt>Primary Decision</dt><dd>${escapeHtml(data.primaryDecision == null ? '—' : `Candidate ${Number(data.primaryDecision) + 1}`)}</dd><dt>Secondary Verification</dt><dd>${escapeHtml(data.secondaryVerification?.verdict || 'Not invoked')}</dd><dt>Final Policy</dt><dd>${escapeHtml(data.finalPolicyDecision || '—')}</dd><dt>Latency</dt><dd>${escapeHtml(data.latencyMs ?? '—')} ms</dd></dl>`;
      if (data.decisionId) document.querySelector('#labelDecisionId').value = data.decisionId;
      result.innerHTML = `<div class="evolution-result-grid">${panel('Phase 4 decision', `${badge(data.status)}${summary}${data.error ? `<p class="muted small">${escapeHtml(data.error)}</p>` : ''}`)}${panel('Confidence', `${confidence('Raw Confidence', data.rawConfidence)}${confidence('Calibrated Confidence', data.calibratedConfidence)}<p class="muted small">${escapeHtml(data.calibrationMethod || 'No active calibration fit')}</p>`)}</div>`;
      void calibration(); void riskCoverage(); void history(); void repairs();
      return;
    }
    if (kind === 'decision') {
      result.innerHTML = `<div class="evolution-result-grid">${jsonPanel('Structured result', data, true)}${confidencePanel(data)}</div>`;
      return;
    }
    const evidence = data.evidence || data.baseline || data;
    const candidates = data.candidates || evidence.candidates;
    const evidenceFields = evidence && typeof evidence === 'object' ? Object.entries(evidence).filter(([key]) => !['candidates', 'timestamp'].includes(key)) : [];
    const evidenceMarkup = `<dl class="evolution-kv">${evidenceFields.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${typeof value === 'object' ? `<code>${escapeHtml(JSON.stringify(value))}</code>` : escapeHtml(value)}</dd>`).join('') || '<dt>Evidence</dt><dd>No evidence fields returned.</dd>'}</dl>`;
    let html = `<div class="evolution-result-grid">${panel('Evidence', evidenceMarkup)}${Array.isArray(candidates) ? panel('Candidate ranking', candidates.length ? candidates.map((candidate, index) => `<div class="evolution-metric"><span>${index + 1}. <code>${escapeHtml(candidate.selector || candidate.id || 'candidate')}</code></span><span>${candidate.visible === false ? 'Hidden' : 'Visible'}${candidate.enabled === false ? ' · Disabled' : ''}</span></div>`).join('') : '<p class="muted small">No candidates returned.</p>') : panel('Evidence status', `<p>${badge(data.failureType || status)}</p>`)}${confidencePanel(data)}`;
    if (data.policy) html += jsonPanel('Risk / policy', data.policy);
    if (data.execution) html += jsonPanel('Execution', data.execution);
    if (data.verification) html += jsonPanel('Verification', data.verification);
    if (data.error || data.message) html += panel('Service message', `<p class="muted">${escapeHtml(data.error || data.message)}</p>`);
    if (!data.policy && !data.execution && !data.verification && kind === 'observation') html += jsonPanel('Observation details', data, true);
    result.innerHTML = `${html}</div>`;
  }
  async function health() {
    serviceCard.classList.remove('is-online', 'is-error'); serviceLabel.textContent = 'Checking service…'; serviceDetail.textContent = 'Evolution service status';
    try { const data = await call('/health'); serviceCard.classList.add('is-online'); serviceLabel.textContent = 'Service online'; serviceDetail.textContent = data.model ? `Configured model · ${data.model}` : 'Health check succeeded'; }
    catch (error) { serviceCard.classList.add('is-error'); serviceLabel.textContent = 'Service unavailable'; serviceDetail.textContent = error.message; }
  }
  async function history() {
    const host = document.querySelector('#history'); host.innerHTML = '<div class="evolution-loading"><span class="evolution-spinner"></span>Loading decision history…</div>';
    try {
      const rows = await call('/api/evolution/history');
      host.innerHTML = rows.length ? rows.map((row) => `<div class="evolution-history-row"><div><b>${escapeHtml(row.decision_type || 'Decision')} · ${escapeHtml(row.model_name || 'Model unavailable')}</b><div class="muted small">${escapeHtml(row.source === 'phase4' ? `Phase 4 · ${row.routing_decision || ''}` : `Evidence ${row.evidence_id ?? '—'}`)} · ${escapeHtml(row.timestamp || row.created_at || '')}</div></div><div>${row.chosen_index == null ? 'No choice' : `Choice ${escapeHtml(Number(row.chosen_index) + 1)}`} · Raw ${row.raw_confidence != null && Number.isFinite(Number(row.raw_confidence)) ? Number(row.raw_confidence).toFixed(3) : '—'} · Calibrated ${row.calibrated_confidence != null && Number.isFinite(Number(row.calibrated_confidence)) ? Number(row.calibrated_confidence).toFixed(3) : 'Unknown'}</div></div>`).join('') : '<div class="empty">No decisions recorded yet.</div>';
    } catch (error) { host.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
  }
  async function repairs() {
    const host = document.querySelector('#repairs'); host.innerHTML = '<div class="evolution-loading"><span class="evolution-spinner"></span>Loading repair history…</div>';
    try {
      const rows = await call('/api/evolution/repairs');
      host.innerHTML = rows.length ? rows.map((row) => `<div class="evolution-history-row"><div><b>Repair ${escapeHtml(row.repair_id || row.id || 'attempt')}</b><div class="muted small">Target ${escapeHtml(row.target_id || row.targetId || '—')} · ${escapeHtml(row.timestamp || row.created_at || '')} · Risk ${escapeHtml(row.risk_level || '—')} · Routing ${escapeHtml(row.routing_decision || '—')}</div><div class="muted small">Raw ${row.raw_confidence != null && Number.isFinite(Number(row.raw_confidence)) ? Number(row.raw_confidence).toFixed(3) : '—'} · Calibrated ${row.calibrated_confidence != null && Number.isFinite(Number(row.calibrated_confidence)) ? Number(row.calibrated_confidence).toFixed(3) : 'Unknown'} · Secondary ${escapeHtml(row.secondary_model || 'not invoked')} · ${escapeHtml(row.latency_ms ?? '—')} ms</div></div><div>${badge(row.final_status || row.status || 'RECORDED')}</div></div>`).join('') : '<div class="empty">No repair attempts recorded yet.</div>';
    } catch (error) { host.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
  }
  async function recommendations() {
    const host = document.querySelector('#recommendations'); host.innerHTML = '<div class="evolution-loading"><span class="evolution-spinner"></span>Loading recommendations…</div>';
    try {
      const category = document.querySelector('#recommendationCategory').value;
      const rows = await call('/api/evolution/recommendations' + (category ? `?category=${encodeURIComponent(category)}` : ''));
      host.innerHTML = rows.length ? rows.map((row) => `<div class="evolution-history-row evolution-recommendation-row"><div><b>${escapeHtml(row.title)} ${badge(row.category)}</b><div class="muted small">${escapeHtml(row.affectedRoute)} · Evidence ${escapeHtml((row.evidenceIds || []).join(', '))} · Confidence ${Number(row.confidence).toFixed(3)} · Risk ${escapeHtml(row.risk)}</div><div class="muted small">${escapeHtml(row.description)}</div><div class="muted small">Status ${escapeHtml(row.status)} · ${escapeHtml((row.implementationPlan || []).join(' → '))}</div></div><div class="row"><button class="btn ghost small" data-recommendation-approval="${escapeHtml(row.id)}" data-approved="true" ${row.status !== 'PROPOSED' ? 'disabled' : ''}>Approve</button><button class="btn ghost small" data-recommendation-approval="${escapeHtml(row.id)}" data-approved="false" ${row.status !== 'PROPOSED' ? 'disabled' : ''}>Reject</button></div></div>`).join('') : '<div class="empty">No evidence-grounded recommendations recorded.</div>';
      host.querySelectorAll('[data-recommendation-approval]').forEach((button) => { button.addEventListener('click', async () => { const id = button.getAttribute('data-recommendation-approval'); const approved = button.getAttribute('data-approved') === 'true'; try { await call(`/api/evolution/recommendations/${id}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved }) }); await recommendations(); } catch (error) { errorState(error); } }); });
    } catch (error) { host.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
  }
  async function patches() {
    const host = document.querySelector('#patches');
    try { const rows = await call('/api/evolution/patches'); host.innerHTML = rows.length ? `<h3>Patch and verification history</h3>` + rows.map((row) => `<div class="evolution-history-row"><div><b>${escapeHtml(row.patch_id)}</b><div class="muted small">Recommendation ${escapeHtml(row.recommendation_id)} · ${escapeHtml(row.final_status)}</div><div class="muted small">Rollback ${escapeHtml(row.rollback || '—')}</div></div>${badge(row.final_status)}</div>`).join('') : '<div class="empty">No controlled patches recorded yet.</div>'; }
    catch (error) { host.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
  }
  async function analyzeTarget() {
    loading('Collecting application evidence and generating grounded recommendations…');
    try { const data = await call('/api/evolution/browser/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: document.querySelector('#targetSelect').value }) }); renderResult({ ...data, status: 'RECOMMENDATIONS_RECORDED' }, 'observation'); await recommendations(); }
    catch (error) { errorState(error); }
  }
  function renderApplicationAnalysis(data) {
    const host = document.querySelector('#applicationAnalysis');
    const evidence = (data.evidence || []).map((item) => `<div class="application-evidence"><b>${escapeHtml(item.id)} · ${escapeHtml(item.kind)}</b><div class="muted small">${escapeHtml(item.source)} · ${escapeHtml(item.route)}</div><p>${escapeHtml(item.observed)}</p>${item.excerpt ? `<pre class="evolution-json">${escapeHtml(item.excerpt)}</pre>` : ''}</div>`).join('');
    const recommendations = (data.recommendations || []).map((item, index) => `<article class="application-recommendation"><div class="application-rec-head"><span class="evolution-step">${String(index + 1).padStart(2, '0')}</span><div><h3>${escapeHtml(item.title)}</h3><span class="chip violet">${escapeHtml(item.category.replaceAll('_', ' '))}</span></div><div>${badge(item.status)}</div></div><dl class="evolution-kv"><dt>Problem</dt><dd>${escapeHtml(item.problem)}</dd><dt>Why it matters</dt><dd>${escapeHtml(item.whyItMatters)}</dd><dt>Improvement</dt><dd>${escapeHtml(item.suggestedImprovement)}</dd><dt>Priority / Impact</dt><dd>${escapeHtml(item.priority || 'Unknown')} / ${escapeHtml(item.impact || 'Unknown')}</dd><dt>Risk</dt><dd>${escapeHtml(item.risk || 'Unknown')}</dd><dt>Confidence</dt><dd>${item.confidence == null ? 'Unknown · CALIBRATION_REQUIRED' : `${(Number(item.confidence) * 100).toFixed(1)}%`}</dd><dt>Evidence</dt><dd>${escapeHtml(item.evidenceIds.join(', '))}${item.evidenceSummary ? `<div class="muted small">Gemma's interpretation: ${escapeHtml(item.evidenceSummary)}</div>` : ''}</dd><dt>Route</dt><dd>${escapeHtml(item.affectedRoute)}</dd></dl>${item.webSources?.length ? `<div class="application-web-sources"><b>References</b>${item.webSources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>`).join('')}</div>` : ''}${item.category === 'FEATURE_OPPORTUNITY' ? '<p class="muted small">Suggestion for consideration; this is not a confirmed defect.</p>' : ''}<div class="row application-rec-actions"><button class="btn ghost small" data-application-review="${escapeHtml(item.id)}" data-approved="true" ${item.status !== 'PROPOSED' ? 'disabled' : ''}>Approve</button><button class="btn ghost small" data-application-review="${escapeHtml(item.id)}" data-approved="false" ${item.status !== 'PROPOSED' ? 'disabled' : ''}>Reject</button><span class="muted small">Patching remains blocked until calibrated confidence is available.</span></div></article>`).join('');
    host.innerHTML = `<div class="application-analysis-head"><div><span class="chip mint">${escapeHtml(data.inputType.toUpperCase())}</span><h3>${escapeHtml(data.target)}</h3><p>${escapeHtml(data.overview)}</p></div><div>${badge(data.calibrationStatus)}<div class="muted small">${escapeHtml(data.model)} · ${(data.totalLatencyMs ?? data.latencyMs)} ms${data.cacheHit ? ' · cache hit' : ''}</div></div></div>${data.page ? `<p class="muted small">Fetched static page: HTTP ${escapeHtml(data.page.status)} · ${escapeHtml(data.page.title)}. JavaScript was not executed.</p>` : ''}${recommendations || '<div class="empty">Gemma found no recommendations that could be grounded in the supplied evidence.</div>'}<details class="application-evidence-list"><summary>Evidence collected (${(data.evidence || []).length})</summary>${evidence}</details>`;
    host.querySelectorAll('[data-application-review]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.getAttribute('data-application-review'); const approved = button.getAttribute('data-approved') === 'true';
      try { const reviewed = await call(`/api/evolution/analyses/${data.analysisId}/recommendations/${id}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved }) }); const next = { ...data, recommendations: data.recommendations.map((rec) => rec.id === id ? reviewed.recommendation : rec) }; renderApplicationAnalysis(next); }
      catch (error) { host.insertAdjacentHTML('afterbegin', `<p class="application-error">${escapeHtml(error.message)}</p>`); }
    }));
  }
  async function analyzeUploaded(kind) {
    const host = document.querySelector('#applicationAnalysis'); host.innerHTML = '<div class="evolution-loading"><span class="evolution-spinner"></span>Collecting evidence and asking Gemma for typed recommendations…</div>';
    try {
      let data;
      if (kind === 'url') {
        const url = document.querySelector('#analysisUrl').value.trim();
        data = await call('/api/evolution/analyze/url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      } else {
        const input = document.querySelector(kind === 'screenshot' ? '#analysisScreenshot' : '#analysisZip'); const file = input.files?.[0];
        if (!file) throw new Error(`Choose a ${kind === 'zip' ? 'project ZIP' : 'screenshot'} first`);
        const headers = { 'Content-Type': kind === 'zip' ? (file.type || 'application/zip') : file.type };
        if (kind === 'zip') headers['X-Project-Name'] = file.name.replace(/\.zip$/i, '').slice(0, 120);
        data = await call(kind === 'zip' ? '/api/evolution/analyze/zip' : '/api/evolution/analyze/screenshot', { method: 'POST', headers, body: file });
      }
      renderApplicationAnalysis(data);
    } catch (error) { host.innerHTML = `<div class="card evolution-panel evolution-error"><h3>Analysis failed</h3><p class="muted">${escapeHtml(error.message)}</p></div>`; }
  }
  async function phase4Repair() {
    loading('Running calibrated selective prediction…');
    try { const data = await call('/api/evolution/phase4/browser/repair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: document.querySelector('#targetSelect').value }) }); renderResult(data, 'phase4'); }
    catch (error) { errorState(error); }
  }
  async function calibration() {
    const host = document.querySelector('#calibrationStatus');
    try {
      const data = await call('/api/evolution/calibration'); const fit = data.fit;
      host.innerHTML = `<h3>Calibration status</h3><dl class="evolution-kv"><dt>Model</dt><dd>${escapeHtml(data.model)}</dd><dt>Active</dt><dd>${data.active ? badge('ACTIVE') : badge('CALIBRATION REQUIRED')}</dd><dt>Method</dt><dd>${escapeHtml(fit?.calibration_method || 'Not fitted')}</dd><dt>Temperature</dt><dd>${fit?.temperature == null ? '—' : Number(fit.temperature).toFixed(4)}</dd><dt>ECE · validation</dt><dd>${fit?.ece == null ? '—' : Number(fit.ece).toFixed(4)}</dd><dt>Brier · validation</dt><dd>${fit?.brier_score == null ? '—' : Number(fit.brier_score).toFixed(4)}</dd><dt>Validation NLL</dt><dd>${fit?.nll == null ? '—' : Number(fit.nll).toFixed(4)}</dd><dt>Split counts</dt><dd>${escapeHtml((data.labeledSamples || []).map((row) => `${row.data_split}: ${row.samples}`).join(' · ') || 'No labeled samples')}</dd></dl>`;
    } catch (error) { host.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`; }
  }
  async function riskCoverage() {
    const host = document.querySelector('#riskCoverage');
    try {
      const data = await call('/api/evolution/risk-coverage');
      const metric = (label, value, percent = false) => `<div class="evolution-metric"><span>${label}</span><b>${value == null ? '—' : percent ? `${(Number(value) * 100).toFixed(1)}%` : Number(value).toFixed(3)}</b></div>`;
      host.innerHTML = data.sampleCount ? `<div class="evolution-result-grid">${panel('Measured Phase 4 outcomes', `<p class="muted small">Labeled samples: ${escapeHtml(data.sampleCount)}</p>${metric('Coverage', data.coverage, true)}${metric('Selective risk', data.selectiveRisk, true)}${metric('Abstention rate', data.abstentionRate, true)}${metric('Secondary invocation rate', data.secondaryInvocationRate, true)}${metric('Mean latency', data.meanLatencyMs == null ? null : data.meanLatencyMs / 1000)}<h4>Risk-coverage dataset</h4><pre class="evolution-json">${pretty(data.dataset)}</pre>`, true)}${panel('Threshold curve', `<pre class="evolution-json">${pretty(data.curve)}</pre>`)}</div>` : '<div class="empty">No labeled calibrated decisions yet. Metrics will appear after real decisions receive ground-truth labels.</div>';
    } catch (error) { host.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
  }
  async function saveLabel() {
    const message = document.querySelector('#calibrationMessage'); message.textContent = 'Saving ground-truth label…';
    try { const data = await call('/api/evolution/calibration/labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisionId: document.querySelector('#labelDecisionId').value.trim(), actualClass: Number(document.querySelector('#actualClass').value), dataSplit: document.querySelector('#dataSplit').value }) }); message.textContent = `Saved decision ${data.decisionId} to ${data.dataSplit} split.`; await calibration(); await riskCoverage(); }
    catch (error) { message.textContent = error.message; }
  }
  async function fitCalibration() {
    const message = document.querySelector('#calibrationMessage'); message.textContent = 'Fitting temperature on calibration split and evaluating on held-out validation…';
    try { const data = await call('/api/evolution/calibration/fit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); message.textContent = `Fit ${data.method} (T=${Number(data.temperature).toFixed(4)}); validation ECE=${data.validation.ece.toFixed(4)}, Brier=${data.validation.brierScore.toFixed(4)}.`; await calibration(); await riskCoverage(); }
    catch (error) { message.textContent = error.message; }
  }
  async function observe() {
    loading('Collecting focused evidence…');
    try { const data = await call('/api/evolution/browser/observe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: document.querySelector('#targetSelect').value }) }); renderResult(data, 'observation'); }
    catch (error) { errorState(error); }
  }
  async function repair() {
    loading('Running the registered, risk-gated repair flow…');
    try { const data = await call('/api/evolution/browser/repair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: document.querySelector('#targetSelect').value }) }); renderResult(data, 'repair'); await repairs(); }
    catch (error) { errorState(error); }
  }
  async function decide() {
    loading('Collecting evidence and requesting a typed decision…');
    try {
      const evidence = await call('/api/evolution/observe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route: location.pathname, target: 'evolution.sample', elementFound: true, elementAttributes: { role: 'button' }, text: 'Run sample decision', aria: { label: 'Run sample decision' }, candidates: [{ selector: '#runDecision', tag: 'button', role: 'button', text: 'Run sample decision', visible: true, enabled: true }] }) });
      const data = await call('/api/evolution/phase4/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evidenceId: evidence.evidenceId }) }); renderResult(data, 'phase4'); await history();
    } catch (error) { errorState(error); }
  }
  document.querySelector('#checkService').onclick = health; document.querySelector('#observeTarget').onclick = observe; document.querySelector('#repairTarget').onclick = repair; document.querySelector('#phase4Repair').onclick = phase4Repair; document.querySelector('#runDecision').onclick = decide; document.querySelector('#refreshHistory').onclick = history; document.querySelector('#refreshRepairs').onclick = repairs; document.querySelector('#refreshCalibration').onclick = calibration; document.querySelector('#refreshRiskCoverage').onclick = riskCoverage; document.querySelector('#saveLabel').onclick = saveLabel; document.querySelector('#fitCalibration').onclick = fitCalibration; document.querySelector('#refreshRecommendations').onclick = recommendations; document.querySelector('#analyzeTarget').onclick = analyzeTarget; document.querySelector('#recommendationCategory').onchange = recommendations;
  document.querySelector('#analyzeScreenshot').onclick = () => analyzeUploaded('screenshot'); document.querySelector('#analyzeUrl').onclick = () => analyzeUploaded('url'); document.querySelector('#analyzeZip').onclick = () => analyzeUploaded('zip');
  health(); history(); repairs(); calibration(); riskCoverage(); recommendations(); patches();
  const section = location.pathname.split('/').filter(Boolean).at(-1);
  const anchor = { observe: '#observeSection', repairs: '#observeSection', history: '#repairsSection' }[section];
  if (anchor) requestAnimationFrame(() => document.querySelector(anchor)?.scrollIntoView({ block: 'start' }));
})();
