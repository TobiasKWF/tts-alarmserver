'use strict';

/**
 * @file services/websocketService.js
 * @description WebSocket-Service für das Live-Dashboard.
 *
 * Bindet sich an den HTTP-Server und leitet alle relevanten EventBus-Events
 * als JSON-Nachrichten an verbundene Dashboard-Clients weiter.
 * Sendet außerdem einen initialen State-Snapshot beim Connect.
 */

const { WebSocketServer } = require('ws');
const config = require('../config');
const logger = require('../utils/logger').child({ service: 'WebSocketService' });
const eventBus = require('../events/eventBus');

/** @type {WebSocketServer|null} */
let wss = null;

/**
 * Events die an Dashboard-Clients weitergeleitet werden.
 * @type {string[]}
 */
const BROADCAST_EVENTS = [
  'alarm.received',
  'alarm.started',
  'alarm.finished',
  'alarm.failed',
  'tts.started',
  'tts.finished',
  'tts.failed',
  'stream.started',
  'stream.finished',
  'stream.failed',
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

  // Alle konfigurierten Events auf den EventBus hören und an Clients senden
  BROADCAST_EVENTS.forEach((eventName) => {
    eventBus.on(eventName, (data) => {
      _broadcast({ type: eventName, ...data });
    });
  });

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

    logger.info('WebSocket-Client verbunden', {
      clientIp,
      totalClients: wss.clients.size,
    });

    ws.on('pong', () => {
      ws._isAlive = true;
    });

    ws.on('message', (rawData) => {
      // Dashboard sendet bisher keine Befehle – ignorieren, nur loggen
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
        reason: reason.toString(),
        remainingClients: wss ? wss.clients.size : 0,
      });
    });

    // Initialen Snapshot senden
    _sendInitialState(ws);
  });

  wss.on('error', (err) => {
    logger.error('WebSocket-Server-Fehler', { error: err.message });
  });

  wss.on('close', () => {
    clearInterval(pingInterval);
    logger.info('WebSocket-Server geschlossen');
  });
}

/**
 * Sendet einen initialen Snapshot an einen neu verbundenen Client.
 * @param {import('ws').WebSocket} ws
 */
function _sendInitialState(ws) {
  try {
    const { QueueService } = require('./queueService');
    const { AlarmService } = require('./alarmService');

    const queueStats = QueueService.getInstance().getStats();
    const alarmStats = AlarmService.getInstance().getStats();
    const history = AlarmService.getInstance().getHistory(20);

    _sendToClient(ws, {
      type: 'snapshot',
      server: {
        version: process.env.npm_package_version || '1.0.0',
        uptime: Math.floor(process.uptime()),
        pid: process.pid,
        nodeEnv: config.server.nodeEnv,
      },
      queue: queueStats,
      alarm: alarmStats,
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
 * Gibt die aktuelle Anzahl verbundener Clients zurück.
 * @returns {number}
 */
function getConnectedClients() {
  return wss ? wss.clients.size : 0;
}

module.exports = { initWebSocket, getConnectedClients };
