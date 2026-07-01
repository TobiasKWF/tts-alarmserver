'use strict';

/**
 * @file services/websocketService.js
 * @description WebSocket-Service für Live-Dashboard-Updates.
 * Reagiert ausschließlich auf Events des Event-Bus und broadcastet
 * diese an alle verbundenen Dashboard-Clients.
 * Kennt weder Routes noch AlarmService direkt.
 */

const { WebSocketServer } = require('ws');
const logger = require('../utils/logger').child({ service: 'WebSocketService' });
const eventBus = require('../events/eventBus');
const config = require('../config');
const HistoryService = require('./historyService');
const { QueueService } = require('./queueService');

/** @type {WebSocketServer|null} */
let wss = null;

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/**
 * Initialisiert den WebSocket-Server gebunden an den HTTP-Server.
 * @param {import('http').Server} httpServer
 */
function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    clients.add(ws);

    logger.info('WebSocket-Client verbunden', {
      ip: clientIp,
      totalClients: clients.size,
    });

    // Initial-State sofort senden
    _sendToClient(ws, {
      type: 'init',
      payload: {
        status: 'online',
        queue: QueueService.getInstance()._getPublicQueue(),
        history: HistoryService.getAll(),
        stats: HistoryService.getStats(),
        serverTime: new Date().toISOString(),
      },
    });

    ws.on('message', (raw) => {
      // Derzeit keine Client→Server-Nachrichten benötigt
      logger.debug('WebSocket-Nachricht empfangen (ignoriert)', { raw: String(raw) });
    });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info('WebSocket-Client getrennt', { totalClients: clients.size });
    });

    ws.on('error', (err) => {
      clients.delete(ws);
      logger.warn('WebSocket-Client Fehler', { error: err.message });
    });
  });

  // Ping-Interval um tote Verbindungen zu erkennen
  const pingInterval = setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) {
        clients.delete(ws);
        continue;
      }
      ws.ping();
    }
  }, config.websocket.pingIntervalMs);

  wss.on('close', () => clearInterval(pingInterval));

  // Event-Bus-Listener registrieren
  _registerEventListeners();

  logger.info('WebSocket-Server initialisiert', { path: '/ws' });
}

/**
 * Registriert alle Event-Bus-Listener.
 * Dashboard und Logger reagieren ausschließlich auf diese Events.
 */
function _registerEventListeners() {
  eventBus.on('alarm.received', (data) => {
    _broadcast({ type: 'alarm.received', payload: data });
  });

  eventBus.on('alarm.started', (data) => {
    _broadcast({ type: 'alarm.started', payload: data });
  });

  eventBus.on('alarm.finished', (data) => {
    _broadcast({
      type: 'alarm.finished',
      payload: { ...data, history: HistoryService.getAll(), stats: HistoryService.getStats() },
    });
  });

  eventBus.on('alarm.failed', (data) => {
    _broadcast({
      type: 'alarm.failed',
      payload: { ...data, history: HistoryService.getAll() },
    });
  });

  eventBus.on('queue.changed', (data) => {
    _broadcast({ type: 'queue.changed', payload: data });
  });

  eventBus.on('queue.empty', (data) => {
    _broadcast({ type: 'queue.empty', payload: data });
  });

  eventBus.on('tts.started', (data) => {
    _broadcast({ type: 'tts.started', payload: data });
  });

  eventBus.on('tts.finished', (data) => {
    _broadcast({ type: 'tts.finished', payload: data });
  });

  eventBus.on('stream.started', (data) => {
    _broadcast({ type: 'stream.started', payload: data });
  });

  eventBus.on('stream.finished', (data) => {
    _broadcast({ type: 'stream.finished', payload: data });
  });

  eventBus.on('server.stopping', (data) => {
    _broadcast({ type: 'server.stopping', payload: data });
  });
}

/**
 * Sendet eine Nachricht an alle verbundenen Clients.
 * @param {object} message
 */
function _broadcast(message) {
  if (clients.size === 0) return;
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload, (err) => {
        if (err) {
          logger.warn('WebSocket-Broadcast fehlgeschlagen', { error: err.message });
          clients.delete(ws);
        }
      });
    }
  }
}

/**
 * Sendet eine Nachricht an einen einzelnen Client.
 * @param {import('ws').WebSocket} ws
 * @param {object} message
 */
function _sendToClient(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message), (err) => {
    if (err) logger.warn('WebSocket-Send fehlgeschlagen', { error: err.message });
  });
}

/**
 * Gibt die Anzahl verbundener Clients zurück.
 * @returns {number}
 */
function getClientCount() {
  return clients.size;
}

module.exports = { initWebSocket, getClientCount };
