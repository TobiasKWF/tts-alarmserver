'use strict';

/**
 * @file server.js
 * @description HTTP-Server und WebSocket-Einstiegspunkt.
 * Startet den Server, initialisiert alle Services und behandelt
 * graceful shutdown.
 */

require('dotenv').config();

const http                    = require('http');
const { createApp }           = require('./app');
const config                  = require('./config');
const logger                  = require('./utils/logger');
const { initWebSocket }       = require('./services/websocketService');
const { initDashboardWS }     = require('./websocket/server');
const { QueueService }        = require('./services/queueService');
const { AlarmService }        = require('./services/alarmService');
const eventBus                = require('./events/eventBus');

let server = null;

/**
 * Startet den HTTP-Server und alle abhaengigen Services.
 */
async function start() {
  try {
    // Konfiguration validieren – wirft bei fehlenden Pflichtfeldern
    config.validate();

    logger.info('TTS-Alarmserver wird gestartet...', {
      version:    process.env.npm_package_version || '1.0.0',
      nodeEnv:    config.server.nodeEnv,
      nodeVersion: process.version,
    });

    // Express-App erstellen
    const app = createApp();

    // HTTP-Server erstellen
    server = http.createServer(app);

    // WebSocket initialisieren (bestehend – REST/Alarm-Clients)
    initWebSocket(server);

    // Dashboard-WebSocket initialisieren (v3.1 – Pfad: /ws/dashboard)
    initDashboardWS(server);

    // Services initialisieren
    const queueService = QueueService.getInstance();
    const alarmService = AlarmService.getInstance();

    // Queue-Worker starten (AlarmService wird als Worker uebergeben)
    queueService.startWorker(alarmService);

    // Server starten
    await new Promise((resolve, reject) => {
      server.listen(config.server.port, config.server.host, (err) => {
        if (err) return reject(err);
        resolve();
      });

      server.once('error', reject);
    });

    const addr        = server.address();
    const displayHost = config.server.host === '0.0.0.0' ? 'localhost' : config.server.host;

    logger.info('TTS-Alarmserver laeuft', {
      host:        config.server.host,
      port:        addr.port,
      dashboard:   `http://${displayHost}:${addr.port}/dashboard`,
      dashboardWS: `ws://${displayHost}:${addr.port}/ws/dashboard`,
      pid:         process.pid,
    });

    eventBus.emit('server.started', { port: addr.port });

  } catch (err) {
    logger.error('Fehler beim Starten des Servers', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

/**
 * Graceful Shutdown – beendet laufende Streams und schliesst Verbindungen.
 * @param {string} signal - Das empfangene Betriebssystem-Signal
 */
async function shutdown(signal) {
  logger.info(`Signal ${signal} empfangen – Graceful Shutdown wird eingeleitet...`);

  eventBus.emit('server.stopping', { signal });

  // Queue anhalten
  try {
    const queueService = QueueService.getInstance();
    await queueService.stop();
    logger.info('Queue gestoppt.');
  } catch (err) {
    logger.warn('Fehler beim Stoppen der Queue', { error: err.message });
  }

  // HTTP-Server schliessen (keine neuen Verbindungen)
  if (server) {
    await new Promise((resolve) => {
      server.close(() => {
        logger.info('HTTP-Server geschlossen.');
        resolve();
      });

      // Erzwinge Shutdown nach 10 Sekunden
      setTimeout(() => {
        logger.warn('Forced shutdown nach Timeout.');
        resolve();
      }, 10_000);
    });
  }

  logger.info('TTS-Alarmserver beendet.');
  process.exit(0);
}

// Signal-Handler fuer Graceful Shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Unbehandelte Fehler abfangen
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: String(reason) });
  process.exit(1);
});

start();
