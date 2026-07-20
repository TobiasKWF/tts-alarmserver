'use strict';

/**
 * @file services/websocketService.js
 * @description WebSocket-Service für das Live-Dashboard.
 */

const { WebSocketServer } = require('ws');
const config         = require('../config');
const logger         = require('../utils/logger').child({ service: 'WebSocketService' });
const eventBus       = require('../events/eventBus');
const queueService   = require('./queueService');
const historyService = require('./historyService');

/** @type {WebSocketServer|null} */
let wss = null;

const BROADCAST_EVENTS = [
  'alarm.received',
  'alarm.started',
  'alarm.finished',
  'history.changed',
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

function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  logger.info('WebSocket-Server initialisiert', { path: '/ws' });

  BROADCAST_EVENTS.forEach((eventName) => {
    eventBus.on(eventName, (data) => {
      _broadcast({ type: eventName, ...data });
    });
  });

  const statsInterval = setInterval(() => {
    if (!wss || wss.clients.size === 0) return;
    _broadcast(_buildStatsPayload());
  }, 10_000);

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

function _buildStatsPayload() {
  const mem         = process.memoryUsage();
  const queueStatus = queueService.status();

  return {
    type: 'server.stats',
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
    queue: {
      running:  queueStatus.running,
      waiting:  queueStatus.waiting,
      maxSize:  queueStatus.maxSize,
    },
    rtp: {
      host: config.rtp.host,
      port: config.rtp.port,
    },
    websocket: {
      connectedClients: wss ? wss.clients.size : 0,
    },
  };
}

function _sendSnapshot(ws) {
  try {
    const stats   = _buildStatsPayload();
    const history = historyService.getLast(50);

    _sendToClient(ws, {
      type:    'snapshot',
      server:  stats.server,
      queue:   stats.queue,
      rtp:     stats.rtp,
      websocket: stats.websocket,
      history,
    });
  } catch (err) {
    logger.warn('Snapshot konnte nicht gesendet werden', { error: err.message });
  }
}

function _broadcast(data) {
  if (!wss || wss.clients.size === 0) return;
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      _sendRaw(client, payload);
    }
  });
}

function _sendToClient(ws, data) {
  if (ws.readyState !== ws.OPEN) return;
  _sendRaw(ws, JSON.stringify(data));
}

function _sendRaw(ws, payload) {
  try {
    ws.send(payload);
  } catch (err) {
    logger.debug('WebSocket send fehlgeschlagen', { error: err.message });
  }
}

function _formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function getConnectedClients() {
  return wss ? wss.clients.size : 0;
}

module.exports = { initWebSocket, getConnectedClients };
