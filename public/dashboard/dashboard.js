/* TTS-Alarmserver Dashboard Client – v3.1 */
'use strict';

(function () {

  // ── Konfiguration ──────────────────────────────────────────
  const WS_URL          = `ws://${location.host}/ws/dashboard`;
  const RECONNECT_INIT  = 1000;
  const RECONNECT_MAX   = 30000;
  const RECONNECT_FACTOR = 2;

  // ── State ──────────────────────────────────────────────────
  let ws            = null;
  let reconnectDelay = RECONNECT_INIT;
  let uptimeBase    = null;   // Server-Uptime bei letztem Snapshot (Sekunden)
  let uptimeLocal   = null;   // lokaler Date.now() beim Empfang des Snapshots
  let speechStart   = null;
  let speechDur     = null;
  let progressTimer = null;

  // ── DOM-Refs ───────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const el = {
    wsStatus:      $('ws-status'),
    themeToggle:   $('theme-toggle'),
    uptime:        $('stat-uptime'),
    ram:           $('stat-ram'),
    wsClients:     $('stat-ws'),
    speechEmpty:   $('speech-empty'),
    speechDetail:  $('speech-detail'),
    speechText:    $('speech-text'),
    speechAlarmId: $('speech-alarm-id'),
    speechVoice:   $('speech-voice'),
    speechProgress:$('speech-progress'),
    queueEmpty:    $('queue-empty'),
    queueTable:    $('queue-table'),
    queueBody:     $('queue-body'),
    historyEmpty:  $('history-empty'),
    historyTable:  $('history-table'),
    historyBody:   $('history-body'),
    historyCount:  $('history-count'),
    errorsEmpty:   $('errors-empty'),
    errorsList:    $('errors-list'),
    errorCount:    $('error-count'),
  };

  // ── Dark/Light-Mode ────────────────────────────────────────
  const html = document.documentElement;
  const savedTheme = localStorage.getItem('dashboard-theme') || 'dark';
  setTheme(savedTheme);

  el.themeToggle.addEventListener('click', () => {
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('dashboard-theme', next);
  });

  function setTheme(theme) {
    html.dataset.theme = theme;
    el.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  // ── WebSocket + Auto-Reconnect ─────────────────────────────
  function connect() {
    setWsStatus('reconnecting');
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      reconnectDelay = RECONNECT_INIT;
      setWsStatus('connected');
    };

    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'snapshot') renderSnapshot(msg);
        else                         applyPatch(msg);
      } catch (e) {
        console.warn('Dashboard WS parse error', e);
      }
    };

    ws.onclose = () => {
      setWsStatus('reconnecting');
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * RECONNECT_FACTOR, RECONNECT_MAX);
    };

    ws.onerror = () => ws.close();
  }

  function setWsStatus(state) {
    el.wsStatus.className = `badge badge--${state}`;
    el.wsStatus.textContent = {
      connected:    'Verbunden',
      disconnected: 'Getrennt',
      reconnecting: 'Verbinde…',
    }[state] || state;
  }

  // ── Snapshot (vollstaendiger State) ────────────────────────
  function renderSnapshot(snap) {
    uptimeBase  = snap.uptime;
    uptimeLocal = Date.now();
    renderUptime();
    renderRam();
    el.wsClients.textContent = snap.wsClients;
    renderSpeech(snap.currentSpeech);
    renderQueue(snap.queue);
    renderHistory(snap.history);
    renderErrors(snap.errors);
    startUptimeTick();
  }

  // ── Delta-Patches ──────────────────────────────────────────
  function applyPatch(msg) {
    switch (msg.type) {
      case 'speech':  renderSpeech(msg.payload);  break;
      case 'queue':   renderQueue(msg.payload);   break;
      case 'history': renderHistory(msg.payload); break;
      case 'error':   renderErrors(msg.payload);  break;
    }
  }

  // ── Uptime-Ticker ──────────────────────────────────────────
  let uptimeTick = null;

  function startUptimeTick() {
    if (uptimeTick) clearInterval(uptimeTick);
    uptimeTick = setInterval(renderUptime, 1000);
  }

  function renderUptime() {
    if (uptimeBase === null) return;
    const seconds = uptimeBase + Math.floor((Date.now() - uptimeLocal) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    el.uptime.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function renderRam() {
    // RAM wird nicht per WS gepusht – Platzhalter fuer zukuenftige Erweiterung
    el.ram.textContent = '–';
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // ── Speech ─────────────────────────────────────────────────
  function renderSpeech(speech) {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }

    if (!speech) {
      el.speechEmpty.classList.remove('hidden');
      el.speechDetail.classList.add('hidden');
      el.speechProgress.style.width = '0%';
      speechStart = null;
      speechDur   = null;
      return;
    }

    el.speechEmpty.classList.add('hidden');
    el.speechDetail.classList.remove('hidden');
    el.speechText.textContent    = speech.text    || '–';
    el.speechAlarmId.textContent = speech.alarmId || '–';
    el.speechVoice.textContent   = speech.voice   || '–';

    speechStart = speech.startedAt || Date.now();
    speechDur   = speech.durationMs || null;

    if (speechDur) {
      progressTimer = setInterval(() => {
        const elapsed = Date.now() - speechStart;
        const pct = Math.min(100, (elapsed / speechDur) * 100);
        el.speechProgress.style.width = pct + '%';
        if (pct >= 100) { clearInterval(progressTimer); progressTimer = null; }
      }, 200);
    }
  }

  // ── Queue ──────────────────────────────────────────────────
  function renderQueue(queue) {
    if (!queue || queue.length === 0) {
      el.queueEmpty.classList.remove('hidden');
      el.queueTable.classList.add('hidden');
      return;
    }
    el.queueEmpty.classList.add('hidden');
    el.queueTable.classList.remove('hidden');
    el.queueBody.innerHTML = queue.map(item => {
      const prioClass = item.priority >= 10 ? 'prio-high' : 'prio-normal';
      return `<tr>
        <td class="${prioClass}">${esc(String(item.priority ?? '–'))}</td>
        <td>${esc(item.id      ?? '–')}</td>
        <td>${esc(item.source  ?? '–')}</td>
        <td>${esc(truncate(item.text, 60))}</td>
      </tr>`;
    }).join('');
  }

  // ── History ────────────────────────────────────────────────
  function renderHistory(history) {
    el.historyCount.textContent = history && history.length ? `(${history.length})` : '';
    if (!history || history.length === 0) {
      el.historyEmpty.classList.remove('hidden');
      el.historyTable.classList.add('hidden');
      return;
    }
    el.historyEmpty.classList.add('hidden');
    el.historyTable.classList.remove('hidden');
    el.historyBody.innerHTML = history.map(entry => {
      const ts     = entry.finishedAt ? formatTime(entry.finishedAt) : '–';
      const status = entry.success ? '✅' : '❌';
      return `<tr>
        <td>${esc(ts)}</td>
        <td>${esc(entry.alarmId ?? '–')}</td>
        <td>${esc(truncate(entry.text, 60))}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');
  }

  // ── Errors ─────────────────────────────────────────────────
  function renderErrors(errors) {
    el.errorCount.textContent = errors && errors.length ? `(${errors.length})` : '';
    if (!errors || errors.length === 0) {
      el.errorsEmpty.classList.remove('hidden');
      el.errorsList.classList.add('hidden');
      return;
    }
    el.errorsEmpty.classList.add('hidden');
    el.errorsList.classList.remove('hidden');
    el.errorsList.innerHTML = errors.map(err => `
      <li>
        <span class="err-time">${esc(formatTime(err.ts))}</span>
        ${esc(err.message)}
      </li>
    `).join('');
  }

  // ── Helpers ────────────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  function formatTime(ts) {
    if (!ts) return '–';
    return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ── Start ──────────────────────────────────────────────────
  connect();

})();
