'use strict';

/**
 * @file services/websocketService.js
 * @description WebSocket-Service für das Live-Dashboard.
 *
 * WS-Pfad: /ws/dashboard  (passend zum Frontend)
 *
 * Nachrichtentypen an Clients:
 *   snapshot      – initialer Komplett-State beim Connect
 *   server        – Server-Stats (alle 10s), payload = { uptime, memory, wsClients }
 *   speech        – aktuelle Durchsage gestartet,  payload = { text, alarmId, voice, ... }
 *   speech:clear  – Durchsage beendet,             payload = null
 *   queue         – Queue-änderung,                payload = Array<item>
 *   history       – History-Update,                payload = Array<item>
 *   error         – neuer Fehler-Eintrag,          payload = Array<item>
 */

const { WebSocketServer } = require('ws');
const config          = require('../config');
const logger          = require('../utils/logger').child({ service: 'WebSocketService' });
const eventBus        = require('../events/eventBus');
const queueService    = require('./queueService');
const historyService  = require('./historyService');
const DashboardState  = require('./dashboardState');

/** @type {WebSocketServer|null} */
let wss = null;

function initWebSocket(httpServer) {
  // Pfad muss mit Frontend übereinstimmen: ws://<host>/ws/dashboard
  wss = new WebSocketServer({ server: httpServer, path: '/ws/dashboard' });

  logger.info('WebSocket-Server initialisiert', { path: '/ws/dashboard' });

  // --- DashboardState-Events → WS-Broadcast ---
  // DashboardState emittiert 'update' mit { type, payload }
  // type: 'speech' | 'queue' | 'history' | 'error'
  const dashState = DashboardState.getInstance();

  dashState.on('update', ({ type, payload }) => {
    if (type === 'speech') {
      if (payload) {
        _broadcast({ type: 'speech', payload });
      } else {
        _broadcast({ type: 'speech:clear', payload: null });
      }
    } else if (type === 'queue') {
      _broadcast({ type: 'queue', payload });
    } else if (type === 'history') {
      _broadcast({ type: 'history', payload });
    } else if (type === 'error') {
      _broadcast({ type: 'error', payload });
    }
  });

  // --- Server-Stats alle 10s ---
  const statsInterval = setInterval(() => {
    if (!wss || wss.clients.size === 0) return;
    _broadcast(_buildServerPayload());
  }, 10_000);

  // --- Ping/Pong Keepalive ---
  const pingInterval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((client) => {
      if (client.readyState !== client.OPEN) return;
      if (client._isAlive === false) {
        logger.debug('WebSocket-Client wegen fehlender Pong-Antwort getrennt');
        client.terminate();
        return;
      }
      client._isAlive = false;
      client.ping();
    });
  }, config.websocket.pingIntervalMs);

  // --- Verbindungshandling ---
  wss.on('connection', (ws, req) => {
    ws._isAlive = true;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    // wsClients-Zähler im DashboardState aktualisieren
    dashState.wsClients = wss.clients.size;

    logger.info('WebSocket-Client verbunden', { clientIp, totalClients: wss.clients.size });

    ws.on('pong', () => { ws._isAlive = true; });
    ws.on('message', (rawData) => {
      logger.debug('WS-Nachricht ignoriert', { data: rawData.toString().slice(0, 100) });
    });
    ws.on('error', (err) => {
      logger.warn('WebSocket-Fehler', { clientIp, error: err.message });
    });
    ws.on('close', (code, reason) => {
      if (wss) dashState.wsClients = wss.clients.size;
      logger.info('WebSocket-Client getrennt', {
        clientIp, code,
        reason: reason.toString(),
        remainingClients: wss ? wss.clients.size : 0,
      });
    });

    _sendSnapshot(ws);
  });

  wss.on('error', (err) => {
    logger.error('WebSocket-Server-Fehler', { error: err.message });
  });

  wss.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(statsInterval);
    logger.info('WebSocket-Server geschlossen');
  });
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

/**
 * Baut server-Stats-Payload im Format das das Frontend erwartet:
 * { type: 'server', payload: { uptime, memory, wsClients } }
 */
function _buildServerPayload() {
  const mem = process.memoryUsage();
  return {
    type: 'server',
    payload: {
      uptime:    Math.floor(process.uptime()),
      wsClients: wss ? wss.clients.size : 0,
      memory: {
        heapUsedMB:  Math.round(mem.heapUsed  / 1_048_576),
        heapTotalMB: Math.round(mem.heapTotal / 1_048_576),
        rssMB:       Math.round(mem.rss       / 1_048_576),
      },
    },
  };
}

/**
 * Sendet initialen Snapshot an neu verbundenen Client.
 * Format passend zu applySnapshot() im Frontend:
 *   { type:'snapshot', server, currentSpeech, queue, history, errors }
 */
function _sendSnapshot(ws) {
  try {
    const mem          = process.memoryUsage();
    const dashState    = DashboardState.getInstance();
    const qs           = queueService.status();

    _sendToClient(ws, {
      type: 'snapshot',
      server: {
        uptime:    Math.floor(process.uptime()),
        wsClients: wss ? wss.clients.size : 0,
        memory: {
          heapUsedMB:  Math.round(mem.heapUsed  / 1_048_576),
          heapTotalMB: Math.round(mem.heapTotal / 1_048_576),
          rssMB:       Math.round(mem.rss       / 1_048_576),
        },
      },
      currentSpeech: dashState.currentSpeech,
      queue:         dashState.queue,
      history:       dashState.history.length > 0
                       ? dashState.history
                       : historyService.getLast(50),
      errors:        dashState.errors,
    });
  } catch (err) {
    logger.warn('Snapshot konnte nicht gesendet werden', { error: err.message });
  }
}

function _broadcast(data) {
  if (!wss || wss.clients.size === 0) return;
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) _sendRaw(client, payload);
  });
}

function _sendToClient(ws, data) {
  if (ws.readyState !== ws.OPEN) return;
  _sendRaw(ws, JSON.stringify(data));
}

function _sendRaw(ws, payload) {
  try { ws.send(payload); } catch (err) {
    logger.debug('WS send fehlgeschlagen', { error: err.message });
  }
}

function getConnectedClients() {
  return wss ? wss.clients.size : 0;
}

module.exports = { initWebSocket, getConnectedClients };
