'use strict';

/**
 * @file server.js
 * @description HTTP-Server Einstiegspunkt.
 */

require('dotenv').config();

const http               = require('http');
const app                = require('./app');
const config             = require('./config');
const logger             = require('./utils/logger');
const { initDashboardWS } = require('./websocket/server');
const eventBus           = require('./events/eventBus');

let server = null;

async function start() {
  try {
    config.validate();

    logger.info('TTS-Alarmserver wird gestartet...', {
      version:    process.env.npm_package_version || '1.0.0',
      nodeEnv:    config.server.nodeEnv,
      nodeVersion: process.version,
    });

    server = http.createServer(app);

    // Dashboard WebSocket auf /ws/dashboard
    initDashboardWS(server);

    await new Promise((resolve, reject) => {
      server.listen(config.server.port, config.server.host, (err) => {
        if (err) return reject(err);
        resolve();
      });
      server.once('error', reject);
    });

    const addr        = server.address();
    const displayHost = config.server.host === '0.0.0.0' ? 'localhost' : config.server.host;

    logger.info('TTS-Alarmserver läuft', {
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

async function shutdown(signal) {
  logger.info(`Signal ${signal} empfangen – Graceful Shutdown...`);
  eventBus.emit('server.stopping', { signal });

  if (server) {
    await new Promise((resolve) => {
      server.close(() => { logger.info('HTTP-Server geschlossen.'); resolve(); });
      setTimeout(() => { logger.warn('Forced shutdown nach Timeout.'); resolve(); }, 10_000);
    });
  }

  logger.info('TTS-Alarmserver beendet.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: String(reason) });
  process.exit(1);
});

start();
