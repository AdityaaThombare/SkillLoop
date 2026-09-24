const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = n => `<svg class="ico"><use href="#i-${n}"/></svg>`;
const initial = n => esc((n || '?')[0].toUpperCase());
const COLORS = ['#8B7CFF', '#4FE3B0', '#FFC24B', '#FF6B7A', '#6CC5FF'];

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) { location.href = '/login'; throw new Error('auth'); }
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong'); e.data = data; toast(e.message); throw e; }
  return data;
}

// A ring of people passing skills around: one shape for every trade loop.
function ring(el, users) {
  const n = users.length, R = 100, C = 150, NR = 24;
  const pts = users.map((u, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [C + R * Math.cos(a), C + R * Math.sin(a)]; });
  let paths = '', nodes = '';
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy), k = (NR + 6) / d;
    const s = [p[0] + dx * k, p[1] + dy * k], e = [q[0] - dx * k, q[1] - dy * k];
    const c = [(s[0] + e[0]) / 2 * .72 + C * .28, (s[1] + e[1]) / 2 * .72 + C * .28];
    paths += `<path class="flow" d="M${s} Q${c} ${e}" fill="none" stroke="#8F97B8" stroke-width="2" marker-end="url(#ah)"/>`;
  });
  pts.forEach((p, i) => {
    nodes += `<g class="node"><circle cx="${p[0]}" cy="${p[1]}" r="${NR}" fill="${COLORS[i % COLORS.length]}"/>
      <text x="${p[0]}" y="${p[1] + 5}" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="700" font-size="16" fill="#10122a">${initial(users[i].name)}</text>
      <text x="${p[0] + (p[0] - C) * .42}" y="${p[1] + (p[1] - C) * .42 + 4}" text-anchor="middle" font-size="12" fill="#ECEFFA">${esc(users[i].name)}</text></g>`;
  });
  el.innerHTML = `<svg class="ring" viewBox="0 0 300 300" role="img" aria-label="Trade loop: ${esc(users.map(u => u.name).join(', '))}">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L9 5L0 9z" fill="#8F97B8"/></marker></defs>
    <circle class="pulse" cx="150" cy="150" r="130"/>${paths}${nodes}</svg>`;
}
let quietUntil = 0;
const quiet = (ms = 4500) => { quietUntil = Date.now() + ms; };
const settle = el => { const r = $('svg.ring', el); if (r) r.classList.add('settled'); quiet(); };
function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts.replace(' ', 'T') + 'Z')) / 1000);
  if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago';
}

// ---- live data: sync the signed-in user, then let each page redraw itself ----
function paintMe(m) {
  Object.assign(ME, m);
  const c = $('#meCredits'), r = $('#meRank'); if (c) c.textContent = m.credits.toFixed(2); if (r) r.textContent = 'Rank #' + m.rank;
}
async function syncMe() { paintMe(await api('/api/me')); }
async function syncAndRefresh() { await syncMe(); if (window.refresh) await window.refresh(); }

let pulseV = null, polling = false;
async function poll() {
  if (document.hidden || polling) return; polling = true;
  try {
    const r = await fetch('/api/pulse');
    if (r.status === 401) { location.href = '/login'; return; }
    const p = await r.json(); $('#live').classList.remove('off');
    const b = $('#teamBadge'); if (b) { b.textContent = p.pending; b.hidden = !p.pending; }
    if (pulseV === null) pulseV = p.v;
    else if (p.v !== pulseV && Date.now() >= quietUntil) { pulseV = p.v; await syncAndRefresh(); }
  } catch (e) { const l = $('#live'); if (l) l.classList.add('off'); }
  finally { polling = false; }
}

// Assistant drawer (rule-based command parser)
function initBot() {
  $('#botFab').onclick = () => $('#botBox').classList.toggle('open');
  $('#botForm').onsubmit = async e => {
    e.preventDefault();
    const inp = $('#botInput'), msg = inp.value.trim(); if (!msg) return;
    const log = $('#botLog'); inp.value = '';
    log.insertAdjacentHTML('beforeend', `<div class="bm you">${esc(msg)}</div>`);
    const res = await api('/api/bot', 'POST', { message: msg });
    log.insertAdjacentHTML('beforeend', `<div class="bm">${esc(res.reply)}</div>`); log.scrollTop = log.scrollHeight;
    if (res.action) syncAndRefresh();
  };
}
async function logout() { await api('/api/logout', 'POST'); location.href = '/login'; }
document.addEventListener('DOMContentLoaded', () => {
  if ($('#botFab')) initBot();
  if ($('#live')) { poll(); setInterval(poll, 3000); document.addEventListener('visibilitychange', poll); }
});

// ---- shared cards ----
const STATUS = { owner: ['violet', 'You created this'], member: ['mint', 'You\'re in'], pending: ['amber', 'Request sent'], declined: ['rose', 'Not accepted'] };
function teamCard(t) {
  const seats = Array.from({ length: t.max_size }, (_, i) => `<i class="${i < t.member_count ? 'f' : ''}"></i>`).join('');
  const needs = t.needs.map(n => `<span class="chip ${t.you_bring && t.you_bring.includes(n.name) ? 'mint' : ''}">${esc(n.name)}</span>`).join('');
  let action = '';
  if (t.my_status) { const [c, l] = STATUS[t.my_status]; action = `<span class="chip ${c}">${l}</span>`; }
  else if (t.is_full) action = `<span class="chip">Team is full</span>`;
  else action = `<button class="btn small" onclick="joinTeam(${t.id})">Request to join</button>`;
  const match = !t.my_status && !t.is_full ? `<div class="match"><div class="bar"><i style="width:${t.match}%"></i></div><b>${t.match}%</b><span class="muted small">match</span></div>` : '';
  const reqs = (t.requests || []).map(r => `<div class="row" style="justify-content:space-between;margin-top:8px"><span>${esc(r.name)} wants to join</span>
    <span class="row"><button class="btn small mint" onclick="answerReq(${t.id},${r.id},'approve')">Accept</button><button class="btn small ghost" onclick="answerReq(${t.id},${r.id},'decline')">Decline</button></span></div>`).join('');
  return `<article class="card team"><h3>${esc(t.name)}</h3><div class="meta">${esc(t.hackathon)} &middot; led by ${esc(t.creator_name)}</div>
    ${t.description ? `<p class="small">${esc(t.description)}</p>` : ''}<div class="tags">${needs}</div>
    <div class="seats" title="${t.member_count} of ${t.max_size} seats filled">${seats}</div>${match}${action}${reqs}</article>`;
}
async function joinTeam(id) { await api(`/api/teams/${id}/join`, 'POST'); toast('Request sent to the team creator'); if (window.refresh) syncAndRefresh(); }
async function answerReq(id, uid, action) { await api(`/api/teams/${id}/requests/${uid}`, 'POST', { action }); toast(action === 'approve' ? 'Added to the team' : 'Request declined'); if (window.refresh) syncAndRefresh(); }
async function addList(kind, skill_id) { await api(`/api/${kind}`, 'POST', { skill_id }); toast(kind === 'offer' ? 'Added to what you can teach' : 'Added to what you want to learn'); await syncAndRefresh(); }
