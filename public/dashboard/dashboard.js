/* global WebSocket */
'use strict';

const WS_URL = `ws://${location.host}/ws/dashboard`;
const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30000;
const FANFARE_FILE = 'fanfare.wav';
const ANNOUNCE_PRIORITY = 5;
const HISTORY_LIMIT = 10;

let ws = null;
let reconnectDelay = RECONNECT_BASE;
let reconnectTimer = null;
let uptimeBase = null;
let progressTimer = null;
let speechStartedAt = null;
let speechDuration = null;
let fanfareTimer = null;
let announceTimer = null;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const html = document.documentElement;
const savedTheme = localStorage.getItem('dashboard-theme');
if (savedTheme) html.dataset.theme = savedTheme;

$('theme-toggle').addEventListener('click', () => {
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  localStorage.setItem('dashboard-theme', next);
  $('theme-toggle').textContent = next === 'dark' ? '\uD83C\uDF19' : '\u2600\uFE0F';
});

const btnAnnounce = $('btn-announce');
const btnAnnounceLabel = $('btn-announce-label');
const announceModal = $('announce-modal');
const announceError = $('announce-modal-error');
const announceSubmit = $('announce-modal-submit');

function openAnnounceModal() {
  announceError.classList.add('hidden');
  announceError.textContent = '';
  announceSubmit.disabled = false;
  announceSubmit.textContent = '\uD83D\uDD0A Durchsage starten';
  announceModal.classList.remove('hidden');
  $('announce-text').focus();
}
function closeAnnounceModal() { announceModal.classList.add('hidden'); }
btnAnnounce.addEventListener('click', openAnnounceModal);
$('announce-modal-close').addEventListener('click', closeAnnounceModal);
$('announce-modal-cancel').addEventListener('click', closeAnnounceModal);
announceModal.addEventListener('click', e => { if (e.target === announceModal) closeAnnounceModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !announceModal.classList.contains('hidden')) closeAnnounceModal(); });
$('announce-text').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); announceSubmit.click(); }
});
announceSubmit.addEventListener('click', async () => {
  const text = $('announce-text').value.trim();
  if (!text) { announceError.textContent = 'Bitte einen Text für die Durchsage eingeben.'; announceError.classList.remove('hidden'); $('announce-text').focus(); return; }
  if (text.length > 2000) { announceError.textContent = 'Der Text darf maximal 2000 Zeichen enthalten.'; announceError.classList.remove('hidden'); $('announce-text').focus(); return; }
  announceSubmit.disabled = true;
  announceSubmit.textContent = '\u23F3 Wird eingereiht...';
  try {
    const res = await fetch('/announce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, priority: ANNOUNCE_PRIORITY }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    closeAnnounceModal(); $('announce-text').value = '';
    btnAnnounce.disabled = true; btnAnnounce.className = 'btn-fanfare state-ok'; btnAnnounceLabel.textContent = '\u2713 Durchsage gestartet';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { btnAnnounce.disabled = false; btnAnnounce.className = 'btn-fanfare'; btnAnnounceLabel.textContent = 'Durchsage'; }, 3000);
  } catch (err) {
    announceSubmit.disabled = false; announceSubmit.textContent = '\uD83D\uDD0A Durchsage starten'; announceError.textContent = `Durchsage konnte nicht gestartet werden: ${err.message}`; announceError.classList.remove('hidden');
  }
});

const btnFanfare = $('btn-fanfare');
const btnFanfareLabel = $('btn-fanfare-label');
btnFanfare.addEventListener('click', async () => {
  if (btnFanfare.disabled) return;
  clearTimeout(fanfareTimer); btnFanfare.disabled = true; btnFanfare.className = 'btn-fanfare'; btnFanfareLabel.textContent = 'Spiele\u2026';
  try {
    const res = await fetch('/announce/fanfare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: FANFARE_FILE }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    btnFanfare.className = 'btn-fanfare state-ok'; btnFanfareLabel.textContent = '\u2713 Gestartet';
  } catch (_) { btnFanfare.className = 'btn-fanfare state-err'; btnFanfareLabel.textContent = '\u2717 Fehler'; btnFanfare.disabled = false; }
  fanfareTimer = setTimeout(() => { btnFanfare.disabled = false; btnFanfare.className = 'btn-fanfare'; btnFanfareLabel.textContent = 'Fanfare'; }, 2500);
});

const modal = $('alarm-modal');
const btnAlarm = $('btn-alarm');
const btnAlarmLbl = $('btn-alarm-label');
const modalError = $('alarm-modal-error');
const submitBtn = $('modal-submit');
let alarmTimer = null;
function openModal() {
  $('alarm-title').value = ''; $('alarm-text').value = ''; $('alarm-address').value = ''; modalError.classList.add('hidden'); modalError.textContent = ''; submitBtn.disabled = false; submitBtn.textContent = '\uD83D\uDEA8 Alarm ausl\u00f6sen'; modal.classList.remove('hidden'); $('alarm-title').focus();
}
function closeModal() { modal.classList.add('hidden'); }
btnAlarm.addEventListener('click', openModal);
$('modal-close').addEventListener('click', closeModal); $('modal-cancel').addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
submitBtn.addEventListener('click', () => {
  const title = $('alarm-title').value.trim(), text = $('alarm-text').value.trim(), address = $('alarm-address').value.trim();
  if (!title) { modalError.textContent = 'Bitte ein Alarmstichwort eingeben.'; modalError.classList.remove('hidden'); $('alarm-title').focus(); return; }
  let rawText = text ? title + ' ' + text : title; if (address) rawText += '\n\nOrt:\n' + address;
  closeModal(); clearTimeout(alarmTimer); btnAlarm.disabled = true; btnAlarm.className = 'btn-alarm state-sending'; btnAlarmLbl.textContent = 'Wird gesendet\u2026';
  fetch('/api/alarm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: rawText }) })
    .then(res => res.json().then(json => ({ ok: res.ok, json })))
    .then(({ ok, json }) => { if (!ok) throw new Error(json.error || 'HTTP-Fehler'); btnAlarm.className = 'btn-alarm state-ok'; btnAlarmLbl.textContent = '\u2713 Alarm gesendet'; })
    .catch(err => { btnAlarm.className = 'btn-alarm state-err'; btnAlarmLbl.textContent = '\u2717 ' + err.message; })
    .finally(() => { alarmTimer = setTimeout(() => { btnAlarm.disabled = false; btnAlarm.className = 'btn-alarm'; btnAlarmLbl.textContent = 'Alarmierung'; }, 3500); });
});

function connect() {
  ws = new WebSocket(WS_URL);
  ws.addEventListener('open', () => { setStatus('connected'); reconnectDelay = RECONNECT_BASE; clearTimeout(reconnectTimer); });
  ws.addEventListener('message', ({ data }) => { try { handleMessage(JSON.parse(data)); } catch (_) {} });
  ws.addEventListener('close', () => { setStatus('reconnecting'); scheduleReconnect(); });
  ws.addEventListener('error', () => { ws.close(); });
}
function scheduleReconnect() { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => { connect(); reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX); }, reconnectDelay); }
function handleMessage(msg) {
  switch (msg.type) {
    case 'snapshot': applySnapshot(msg); break;
    case 'speech': applySpeech(msg.payload); break;
    case 'speech:clear': clearSpeech(); break;
    case 'queue': applyQueue(msg.payload); break;
    case 'history': applyHistory(msg.payload); break;
    case 'error': applyErrors(msg.payload); break;
    case 'server': applyServer(msg.payload); break;
  }
}
function applySnapshot(snap) {
  if (snap.server) applyServer(snap.server); if (snap.currentSpeech) applySpeech(snap.currentSpeech); else clearSpeech(); if (snap.queue) applyQueue(snap.queue); if (snap.history) applyHistory(snap.history); if (snap.errors) applyErrors(snap.errors);
}
function applyServer(s) { if (s.uptime != null) { uptimeBase = Date.now() - s.uptime * 1000; tickUptime(); } if (s.memory) $('stat-ram').textContent = (s.memory.heapUsedMB ?? s.memory) + ' MB'; if (s.wsClients != null) $('stat-ws').textContent = s.wsClients; }
setInterval(() => { if (uptimeBase != null) tickUptime(); }, 1000);
function tickUptime() { const secs = Math.floor((Date.now() - uptimeBase) / 1000); $('stat-uptime').textContent = formatUptime(secs); }
function applySpeech(sp) {
  if (!sp) { clearSpeech(); return; }
  $('speech-empty').classList.add('hidden'); $('speech-detail').classList.remove('hidden'); $('speech-text').textContent = sp.text || ''; $('speech-alarm-id').textContent = sp.alarmId || ''; $('speech-voice').textContent = sp.voice || '';
  clearInterval(progressTimer);
  if (sp.startedAt && sp.durationMs) { speechStartedAt = sp.startedAt; speechDuration = sp.durationMs; progressTimer = setInterval(() => { const pct = Math.min(100, (Date.now() - speechStartedAt) / speechDuration * 100); $('speech-progress').style.width = pct + '%'; if (pct >= 100) clearInterval(progressTimer); }, 200); }
}
function clearSpeech() { clearInterval(progressTimer); $('speech-progress').style.width = '0%'; $('speech-detail').classList.add('hidden'); $('speech-empty').classList.remove('hidden'); }
function applyQueue(items) {
  const body = $('queue-body'); if (!items || items.length === 0) { $('queue-table').classList.add('hidden'); $('queue-empty').classList.remove('hidden'); return; }
  $('queue-empty').classList.add('hidden'); $('queue-table').classList.remove('hidden');
  body.innerHTML = items.map(it => `<tr><td class="${it.priority <= 2 ? 'prio-high' : 'prio-normal'}">${esc(it.priority ?? 5)}</td><td style="font-size:11px;color:var(--text-muted)">${esc((it.id || '').slice(0,8))}</td><td>${esc(it.source || 'api')}</td><td>${esc(it.text || '')}</td></tr>`).join('');
}
function applyHistory(items) {
  const body = $('history-body');
  if (!items || items.length === 0) { $('history-table').classList.add('hidden'); $('history-empty').classList.remove('hidden'); $('history-count').textContent = ''; return; }
  const latest = items.slice().reverse().slice(0, HISTORY_LIMIT);
  $('history-empty').classList.add('hidden'); $('history-table').classList.remove('hidden'); $('history-count').textContent = `(${latest.length})`;
  body.innerHTML = latest.map(it => {
    const ok = it.success !== false;
    const time = it.finishedAt ? new Date(it.finishedAt).toLocaleTimeString('de-DE') : '';
    return `<tr><td style="white-space:nowrap;font-size:12px;color:var(--text-muted)">${esc(time)}</td><td style="font-size:11px;color:var(--text-muted)">${esc((it.alarmId||'').slice(0,8))}</td><td>${esc(it.text || '')}</td><td style="color:${ok ? 'var(--success)' : 'var(--danger)'}">${ok ? '\u2713' : '\u2717'}</td></tr>`;
  }).join('');
}
function applyErrors(items) {
  const list = $('errors-list'); if (!items || items.length === 0) { list.classList.add('hidden'); $('errors-empty').classList.remove('hidden'); $('error-count').textContent = ''; return; }
  $('errors-empty').classList.add('hidden'); list.classList.remove('hidden'); $('error-count').textContent = `(${items.length})`;
  list.innerHTML = items.slice().reverse().map(it => { const time = it.ts ? new Date(it.ts).toLocaleTimeString('de-DE') : ''; return `<li><span class="err-time">${esc(time)}</span>${esc(it.message || it.error || String(it))}</li>`; }).join('');
}
function setStatus(state) { const el = $('ws-status'); el.className = 'badge badge--' + state; el.textContent = { connected: 'Verbunden', reconnecting: 'Verbinde...', disconnected: 'Getrennt' }[state] || state; }
function formatUptime(s) { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; if (d > 0) return `${d}d ${h}h ${m}m`; if (h > 0) return `${h}h ${m}m ${sec}s`; return `${m}m ${sec}s`; }
connect();
