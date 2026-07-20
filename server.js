'use strict';

/**
 * @file server.js
 * @description Einstiegspunkt fuer systemd / node server.js.
 */

require('dotenv').config();

const http                = require('http');
const app                 = require('./src/app');
const config              = require('./src/config');
const logger              = require('./src/logging/logger');
const { initWebSocket }   = require('./src/services/websocketService');
const { initDashboardWS } = require('./src/websocket/server');

const PORT = config.server.port;
const HOST = config.server.host;

const server = http.createServer(app);

initWebSocket(server);
initDashboardWS(server);

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  logger.info('TTS-Alarmserver v3.1 gestartet', {
    host:        HOST,
    port:        PORT,
    dashboard:   `http://${displayHost}:${PORT}/dashboard`,
    dashboardWS: `ws://${displayHost}:${PORT}/ws/dashboard`,
    pid:         process.pid,
  });
});

server.on('error', (err) => {
  logger.error('Server-Fehler', { error: err.message });
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM empfangen \u2013 Server wird beendet...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT empfangen \u2013 Server wird beendet...');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: String(reason) });
  process.exit(1);
});
