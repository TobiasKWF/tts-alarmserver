'use strict';

/**
 * @file app.js
 * @description Express Application Factory.
 */

const express = require('express');
const helmet  = require('helmet');
const path    = require('path');

const config = require('./config');
const logger = require('./utils/logger');

const {
  requestId,
  requestLogger,
  errorHandler,
  notFoundHandler,
  apiKeyAuth,
  globalLimiter,
  announceLimiter,
  diveraLimiter,
  corsMiddleware,
  sanitize,
} = require('./middleware');

const announceRouter = require('./routes/announce');
const diveraRouter   = require('./routes/divera');
const healthRouter   = require('./routes/health');
const statsRouter    = require('./routes/stats');
const voicesRouter   = require('./routes/voices');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(corsMiddleware);
  app.options('*', corsMiddleware);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:  ["'self'"],
          scriptSrc:   ["'self'", "'unsafe-inline'"],
          styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc:     ["'self'", 'data:', 'https://fonts.gstatic.com'],
          // fetch() darf an beliebige gleiche Origin gehen
          // (IP-Adresse, Hostname – egal wie das Dashboard aufgerufen wird)
          connectSrc:  ["'self'", '*'],
          imgSrc:      ["'self'", 'data:'],
          objectSrc:   ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(sanitize);
  app.use(requestId);
  app.use(requestLogger);

  app.use((req, res, next) => {
    if (req.path === '/ws' || req.path.startsWith('/health')) return next();
    return globalLimiter(req, res, next);
  });

  const staticOpts = { maxAge: 0, index: 'index.html' };
  const publicDir  = path.join(__dirname, '..', 'public');

  app.use('/',          express.static(publicDir, staticOpts));
  app.use('/dashboard', express.static(publicDir, staticOpts));

  app.use('/health',   healthRouter);
  app.use('/stats',    statsRouter);
  app.use('/announce', apiKeyAuth, announceLimiter, announceRouter);

  app.post('/play-fanfare', apiKeyAuth, announceLimiter, (req, res, next) => {
    req.url = '/fanfare';
    announceRouter(req, res, next);
  });

  app.use('/divera', diveraLimiter, diveraRouter);
  app.use('/voices', voicesRouter);
  app.use('/voice',  voicesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info('Express-App konfiguriert', {
    env: config.server.nodeEnv,
    routes: [
      'GET  /  (Dashboard)',
      'GET  /dashboard',
      'GET  /health',
      'GET  /stats',
      'POST /announce',
      'POST /play-fanfare',
      'POST /divera',
      'GET  /voices',
    ],
  });

  return app;
}

module.exports = { createApp };
