'use strict';

/**
 * @file websocket/server.js
 * @description Dedizierter WebSocket-Endpoint fuer das Dashboard (v3.1).
 * Pfad: /ws/dashboard – getrennt vom bestehenden websocketService.
 *
 * - Sendet bei Verbindung sofort einen vollstaendigen Snapshot.
 * - Abonniert DashboardState-Events und pusht Delta-Updates.
 * - Zaehlt aktive Clients im DashboardState.
 */

const { WebSocketServer } = require('ws');
const DashboardState      = require('../services/dashboardState');
const logger              = require('../utils/logger');

/**
 * Initialisiert den Dashboard-WebSocket-Server.
 * @param {import('http').Server} httpServer
 * @returns {WebSocketServer}
 */
function initDashboardWS(httpServer) {
  const state = DashboardState.getInstance();

  const wss = new WebSocketServer({
    server: httpServer,
    path:   '/ws/dashboard',
  });

  wss.on('connection', (ws, req) => {
    state.wsClients++;
    logger.info('Dashboard WS-Client verbunden', {
      ip:      req.socket.remoteAddress,
      clients: state.wsClients,
    });

    // Sofort vollstaendigen Snapshot senden
    send(ws, state.getSnapshot());

    // Delta-Updates weiterleiten
    const onUpdate = (msg) => send(ws, msg);
    state.on('update', onUpdate);

    ws.on('close', () => {
      state.wsClients = Math.max(0, state.wsClients - 1);
      state.removeListener('update', onUpdate);
      logger.info('Dashboard WS-Client getrennt', { clients: state.wsClients });
    });

    ws.on('error', (err) => {
      logger.warn('Dashboard WS-Fehler', { error: err.message });
    });
  });

  logger.info('Dashboard WebSocket bereit', { path: '/ws/dashboard' });
  return wss;
}

/**
 * Sendet JSON sicher an einen WebSocket-Client.
 * @param {import('ws')} ws
 * @param {object} data
 */
function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      logger.warn('Dashboard WS send-Fehler', { error: err.message });
    }
  }
}

module.exports = { initDashboardWS };
