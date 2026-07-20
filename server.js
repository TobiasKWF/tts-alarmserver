'use strict';

/**
 * TTS Alarmserver v3 - Einstiegspunkt
 * Startet den HTTP-Server und initialisiert alle Services.
 */

const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/logging/logger');

const PORT = config.server.port;
const HOST = config.server.host;

const server = app.listen(PORT, HOST, () => {
  logger.info(`TTS Alarmserver v3 gestartet auf http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  logger.error('Server-Fehler:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM empfangen – Server wird beendet...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  logger.info('SIGINT empfangen – Server wird beendet...');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  logger.error('Nicht abgefangene Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Nicht behandelte Promise-Ablehnung:', reason);
});
