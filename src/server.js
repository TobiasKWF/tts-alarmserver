'use strict';

/**
 * @file server.js
 * @description HTTP-Server Einstiegspunkt.
 * Startet den PiperDaemon beim Hochfahren damit das Modell bereits geladen
 * ist wenn der erste Alarm eintrifft.
 */

const http         = require('http');
const app          = require('./app');
const config       = require('./config');
const logger       = require('./logging/logger');
const PiperDaemon  = require('./services/piperDaemon');
const { ensureTmpDir } = require('./utils/tempFiles');

const server = http.createServer(app);

async function start() {
  // TMP-Verzeichnis sicherstellen
  await ensureTmpDir();

  // Piper-Daemon vorladen (Modell wird einmal in RAM geladen)
  logger.info('Lade Piper-Modell vor...');
  const daemon = PiperDaemon.getInstance();
  await daemon.start();
  logger.info('Piper-Daemon bereit.');

  // HTTP-Server starten
  server.listen(config.server.port, config.server.host, () => {
    logger.info(`TTS-Alarmserver läuft auf http://${config.server.host}:${config.server.port}`);
  });

  // Graceful Shutdown
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

function shutdown(signal) {
  logger.info(`${signal} empfangen – fahre herunter...`);
  PiperDaemon.getInstance().stop();
  server.close(() => {
    logger.info('HTTP-Server gestoppt.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

start().catch(err => {
  logger.error(`Startfehler: ${err.message}`);
  process.exit(1);
});
