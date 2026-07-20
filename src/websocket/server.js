'use strict';

/**
 * @file websocket/server.js
 * @description Dashboard WebSocket auf /ws/dashboard.
 *
 * Snapshot-Format (passend zu applySnapshot() im Frontend):
 *   {
 *     type: 'snapshot',
 *     server:        { uptime, wsClients, memory },
 *     currentSpeech: null | { text, alarmId, voice, startedAt, durationMs },
 *     queue:         Array<item>,
 *     history:       Array<item>,
 *     errors:        Array<item>
 *   }
 *
 * Delta-Updates:
 *   { type: 'speech',       payload: { text, alarmId, ... } }
 *   { type: 'speech:clear', payload: null }
 *   { type: 'queue',        payload: Array }
 *   { type: 'history',      payload: Array }
 *   { type: 'error',        payload: Array }
 *   { type: 'server',       payload: { uptime, wsClients, memory } }  (alle 10s)
 */

const { WebSocketServer } = require('ws');
const DashboardState      = require('../services/dashboardState');
const historyService      = require('../services/historyService');
const logger              = require('../utils/logger');

let _wss = null;

function initDashboardWS(httpServer) {
  const state = DashboardState.getInstance();

  _wss = new WebSocketServer({
    server: httpServer,
    path:   '/ws/dashboard',
  });

  // --- Server-Stats alle 10s an alle Clients ---
  const statsInterval = setInterval(() => {
    if (!_wss || _wss.clients.size === 0) return;
    _broadcast({ type: 'server', payload: _serverStats() });
  }, 10_000);

  _wss.on('connection', (ws, req) => {
    state.wsClients = _wss.clients.size;
    logger.info('Dashboard WS-Client verbunden', {
      ip:      req.socket.remoteAddress,
      clients: state.wsClients,
    });

    // Sofort vollständigen Snapshot senden
    _send(ws, _buildSnapshot(state));

    // Delta-Updates: DashboardState emittiert { type, payload }
    const onUpdate = ({ type, payload }) => {
      if (type === 'speech') {
        // payload===null bedeutet Durchsage beendet -> speech:clear
        if (payload === null) {
          _send(ws, { type: 'speech:clear', payload: null });
        } else {
          _send(ws, { type: 'speech', payload });
        }
      } else if (type === 'queue' || type === 'history' || type === 'error') {
        _send(ws, { type, payload });
      }
    };

    state.on('update', onUpdate);

    ws.on('close', () => {
      state.wsClients = Math.max(0, (_wss ? _wss.clients.size : 0));
      state.removeListener('update', onUpdate);
      logger.info('Dashboard WS-Client getrennt', { clients: state.wsClients });
    });

    ws.on('error', (err) => {
      logger.warn('Dashboard WS-Fehler', { error: err.message });
    });
  });

  _wss.on('close', () => {
    clearInterval(statsInterval);
  });

  logger.info('Dashboard WebSocket bereit', { path: '/ws/dashboard' });
  return _wss;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _buildSnapshot(state) {
  const history = state.history.length > 0
    ? state.history
    : historyService.getLast(50);

  return {
    type:          'snapshot',
    server:        _serverStats(),
    currentSpeech: state.currentSpeech,
    queue:         state.queue,
    history,
    errors:        state.errors,
  };
}

function _serverStats() {
  const mem = process.memoryUsage();
  return {
    uptime:    Math.floor(process.uptime()),
    wsClients: _wss ? _wss.clients.size : 0,
    memory: {
      heapUsedMB:  Math.round(mem.heapUsed  / 1_048_576),
      heapTotalMB: Math.round(mem.heapTotal / 1_048_576),
      rssMB:       Math.round(mem.rss       / 1_048_576),
    },
  };
}

function _broadcast(data) {
  if (!_wss || _wss.clients.size === 0) return;
  const payload = JSON.stringify(data);
  _wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      try { client.send(payload); } catch (_) {}
    }
  });
}

function _send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (err) {
      logger.warn('Dashboard WS send-Fehler', { error: err.message });
    }
  }
}

module.exports = { initDashboardWS };
