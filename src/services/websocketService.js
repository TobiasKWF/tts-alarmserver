'use strict';

/**
 * @file services/websocketService.js
 * @description WebSocket-Service für das Live-Dashboard.
 * Lauscht auf EventBus-Events und broadcastet Zustandsänderungen
 * an alle verbundenen Dashboard-Clients.
 */

const { WebSocketServer } = require('ws');
const logger = require('../utils/logger').child({ service: 'WebSocketService' });
const eventBus = require('../events/eventBus');
const config = require('../config');

/** @type {WebSocketServer|null} */
let wss = null;

/** @type {NodeJS.Timeout|null} */
let pingInterval = null;

/**
 * Initialisiert den WebSocket-Server, gebunden an den HTTP-Server.
 * @param {import('http').Server} httpServer
 */
function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logger.info('WebSocket-Client verbunden', { ip: clientIp, clients: wss.clients.size });

    // Willkommensnachricht mit aktuellem Status
    _sendToClient(ws, {
      type: 'connected',
      payload: {
        serverTime: new Date().toISOString(),
        clients: wss.clients.size,
      },
    });

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        _handleClientMessage(ws, msg);
      } catch {
        logger.debug('Ungültige WebSocket-Nachricht empfangen', { data: String(data) });
      }
    });

    ws.on('close', () => {
      logger.debug('WebSocket-Client getrennt', { clients: wss.clients.size });
    });

    ws.on('error', (err) => {
      logger.warn('WebSocket-Fehler', { error: err.message });
    });
  });

  wss.on('error', (err) => {
    logger.error('WebSocketServer-Fehler', { error: err.message });
  });

  // Heartbeat: tote Verbindungen bereinigen
  pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, config.websocket.pingIntervalMs);

  // EventBus-Listener registrieren
  _registerEventListeners();

  logger.info('WebSocket-Server initialisiert', { path: '/ws' });
}

/**
 * Verarbeitet eingehende Client-Nachrichten.
 * @param {import('ws').WebSocket} ws
 * @param {object} msg
 */
function _handleClientMessage(ws, msg) {
  if (msg.type === 'ping') {
    _sendToClient(ws, { type: 'pong', payload: { time: new Date().toISOString() } });
    return;
  }

  if (msg.type === 'subscribe') {
    // Erweiterungspunkt: Event-Subscriptions pro Client
    logger.debug('Client subscribe', { channel: msg.channel });
  }
}

/**
 * Registriert alle EventBus-Listener und überträgt die Events ans Dashboard.
 */
function _registerEventListeners() {
  const events = [
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

  events.forEach((event) => {
    eventBus.on(event, (data) => {
      broadcast({ type: event, payload: data });
    });
  });

  logger.debug('EventBus-Listener registriert', { count: events.length });
}

/**
 * Sendet eine Nachricht an alle verbundenen Clients.
 * @param {object} message
 */
function broadcast(message) {
  if (!wss || wss.clients.size === 0) return;

  const payload = JSON.stringify(message);

  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload, (err) => {
        if (err) {
          logger.warn('WebSocket-Send fehlgeschlagen', { error: err.message });
        }
      });
    }
  });
}

/**
 * Sendet eine Nachricht an einen einzelnen Client.
 * @param {import('ws').WebSocket} ws
 * @param {object} message
 */
function _sendToClient(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message), (err) => {
      if (err) {
        logger.warn('WebSocket-Send fehlgeschlagen', { error: err.message });
      }
    });
  }
}

/**
 * Gibt die Anzahl der verbundenen Clients zurück.
 * @returns {number}
 */
function getClientCount() {
  return wss ? wss.clients.size : 0;
}

/**
 * Beendet den WebSocket-Server sauber.
 */
function close() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (wss) {
    wss.close(() => logger.info('WebSocket-Server geschlossen.'));
    wss = null;
  }
}

module.exports = { initWebSocket, broadcast, getClientCount, close };
