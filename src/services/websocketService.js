'use strict';

/**
 * @file services/websocketService.js
 * @description WebSocket-Service für das Live-Dashboard.
 *
 * Bindet sich an den HTTP-Server und leitet alle relevanten EventBus-Events
 * als JSON-Nachrichten an verbundene Dashboard-Clients weiter.
 * Sendet außerdem einen initialen State-Snapshot beim Connect und
 * alle 10 Sekunden ein server.stats-Update.
 *
 * Protokoll (Client empfängt):
 *   { type: 'snapshot',    server, queue, alarm, history }
 *   { type: 'server.stats', server, queue, alarm }
 *   { type: 'alarm.received',  alarmId, text, priority, position, queueSize }
 *   { type: 'alarm.started',   alarmId, text, voice, priority }
 *   { type: 'alarm.finished',  alarmId, durationMs, status }
 *   { type: 'alarm.failed',    alarmId, error, code }
 *   { type: 'tts.started',     alarmId, voice, textLength }
 *   { type: 'tts.finished',    alarmId, voice, outputFile, sizeBytes, durationMs }
 *   { type: 'tts.error',       alarmId, voice, error }
 *   { type: 'stream.started',  alarmId, rtpUrl }
 *   { type: 'stream.finished', alarmId, rtpUrl, durationMs }
 *   { type: 'stream.error',    alarmId, rtpUrl, error }
 *   { type: 'queue.changed',   size, items, paused? }
 *   { type: 'queue.empty' }
 */

const { WebSocketServer } = require('ws');
const config    = require('../config');
const logger    = require('../utils/logger').child({ service: 'WebSocketService' });
const eventBus  = require('../events/eventBus');

/** @type {WebSocketServer|null} */
let wss = null;

/**
 * Events die an Dashboard-Clients weitergeleitet werden.
 * Muss mit dem Protokoll oben synchron gehalten werden.
 * @type {string[]}
 */
const BROADCAST_EVENTS = [
  'alarm.received',
  'alarm.started',
  'alarm.finished',
  'alarm.failed',
  'tts.started',
  'tts.finished',
  'tts.error',
  'stream.started',
  'stream.finished',
  'stream.error',
  'queue.changed',
  'queue.empty',
  'server.started',
  'server.stopping',
];

/**
 * Initialisiert den WebSocket-Server und bindet ihn an den HTTP-Server.
 * @param {import('http').Server} httpServer
 */
function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  logger.info('WebSocket-Server initialisiert', { path: '/ws' });

  // Alle konfigurierten Events auf den EventBus hören und als Broadcast senden
  BROADCAST_EVENTS.forEach((eventName) => {
    eventBus.on(eventName, (data) => {
      _broadcast({ type: eventName, ...data });
    });
  });

  // Regelmäßiges server.stats-Update (alle 10s)
  const statsInterval = setInterval(() => {
    if (!wss || wss.clients.size === 0) return;
    _broadcast(_buildStatsPayload());
  }, 10_000);

  // Ping-Pong Keepalive
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

  wss.on('connection', (ws, req) => {
    ws._isAlive = true;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    logger.info('WebSocket-Client verbunden', { clientIp, totalClients: wss.clients.size });

    ws.on('pong', () => { ws._isAlive = true; });

    ws.on('message', (rawData) => {
      logger.debug('WebSocket-Nachricht empfangen (ignoriert)', {
        clientIp,
        data: rawData.toString().slice(0, 100),
      });
    });

    ws.on('error', (err) => {
      logger.warn('WebSocket-Fehler', { clientIp, error: err.message });
    });

    ws.on('close', (code, reason) => {
      logger.info('WebSocket-Client getrennt', {
        clientIp,
        code,
        reason:           reason.toString(),
        remainingClients: wss ? wss.clients.size : 0,
      });
    });

    // Initialen Snapshot senden
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
 * Baut das server.stats Payload auf.
 * @returns {object}
 */
function _buildStatsPayload() {
  const { QueueService } = require('./queueService');
  const { AlarmService } = require('./alarmService');
  const { getConnectedClients } = module.exports;

  const mem = process.memoryUsage();

  return {
    type:  'server.stats',
    server: {
      version:     process.env.npm_package_version || '1.0.0',
      uptime:      Math.floor(process.uptime()),
      uptimeHuman: _formatUptime(process.uptime()),
      pid:         process.pid,
      nodeEnv:     config.server.nodeEnv,
      memory: {
        heapUsedMB:  Math.round(mem.heapUsed  / 1_048_576),
        heapTotalMB: Math.round(mem.heapTotal / 1_048_576),
        rssMB:       Math.round(mem.rss       / 1_048_576),
      },
    },
    queue:  QueueService.getInstance().getStats(),
    alarm:  AlarmService.getInstance().getStats(),
    rtp: {
      host: config.rtp.host,
      port: config.rtp.port,
    },
    websocket: {
      connectedClients: wss ? wss.clients.size : 0,
    },
  };
}

/**
 * Sendet einen initialen Snapshot (type='snapshot') an einen neu verbundenen Client.
 * @param {import('ws').WebSocket} ws
 */
function _sendSnapshot(ws) {
  try {
    const { AlarmService } = require('./alarmService');
    const stats   = _buildStatsPayload();
    const history = AlarmService.getInstance().getHistory(20);

    _sendToClient(ws, {
      type:    'snapshot',
      server:  stats.server,
      queue:   stats.queue,
      alarm:   stats.alarm,
      rtp:     stats.rtp,
      websocket: stats.websocket,
      history,
    });
  } catch (err) {
    logger.warn('Snapshot konnte nicht gesendet werden', { error: err.message });
  }
}

/**
 * Sendet eine Nachricht an alle verbundenen Dashboard-Clients.
 * @param {object} data
 */
function _broadcast(data) {
  if (!wss || wss.clients.size === 0) return;
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      _sendRaw(client, payload);
    }
  });
}

/**
 * Sendet eine Nachricht an einen einzelnen Client (JSON serialisiert).
 * @param {import('ws').WebSocket} ws
 * @param {object} data
 */
function _sendToClient(ws, data) {
  if (ws.readyState !== ws.OPEN) return;
  _sendRaw(ws, JSON.stringify(data));
}

/**
 * Sendet rohen String an einen WebSocket-Client – fängt Fehler ab.
 * @param {import('ws').WebSocket} ws
 * @param {string} payload
 */
function _sendRaw(ws, payload) {
  try {
    ws.send(payload);
  } catch (err) {
    logger.debug('WebSocket send fehlgeschlagen', { error: err.message });
  }
}

/**
 * Formatiert Sekunden als menschenlesbare Uptime.
 * @param {number} seconds
 * @returns {string}
 */
function _formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

/**
 * Gibt die aktuelle Anzahl verbundener Clients zurück.
 * @returns {number}
 */
function getConnectedClients() {
  return wss ? wss.clients.size : 0;
}

module.exports = { initWebSocket, getConnectedClients };
