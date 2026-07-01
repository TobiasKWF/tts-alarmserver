'use strict';

/**
 * @file app.js
 * @description Express Application Factory.
 * Erstellt und konfiguriert die Express-Anwendung ohne sie zu starten.
 * Trennt Application-Setup von Server-Lifecycle.
 */

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const config = require('./config');
const logger = require('./utils/logger');
const { requestIdMiddleware } = require('./middleware/requestId');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const { notFoundHandler } = require('./middleware/notFoundHandler');
const { apiKeyAuth } = require('./middleware/apiKeyAuth');
const announceRoutes = require('./routes/announce');
const diveraRoutes = require('./routes/divera');
const healthRoutes = require('./routes/health');
const statsRoutes = require('./routes/stats');
const voiceRoutes = require('./routes/voices');

/**
 * Erstellt und konfiguriert die Express-Anwendung.
 * @returns {express.Application}
 */
function createApp() {
  const app = express();

  // --- Sicherheits-Header ---
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          imgSrc: ["'self'", 'data:'],
        },
      },
    })
  );

  // --- Body-Parser ---
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // --- Request-ID (muss vor allen anderen Middlewares kommen) ---
  app.use(requestIdMiddleware);

  // --- HTTP-Request-Logging via Morgan → Winston ---
  app.use(
    morgan('combined', {
      stream: {
        write: (message) => logger.http(message.trim()),
      },
      skip: (req) => req.url === '/health',
    })
  );

  // --- Strukturiertes Request-Logging ---
  app.use(requestLogger);

  // --- Statische Dateien (Dashboard) ---
  app.use(
    '/dashboard',
    express.static(path.join(__dirname, '..', 'public'), {
      maxAge: config.server.nodeEnv === 'production' ? '1h' : 0,
    })
  );

  // --- Root Redirect auf Dashboard ---
  app.get('/', (req, res) => {
    res.redirect('/dashboard');
  });

  // --- API Routes ---
  // Health und Stats sind öffentlich zugänglich
  app.use('/health', healthRoutes);
  app.use('/stats', statsRoutes);

  // Alle weiteren API-Routen erfordern ggf. API-Key-Authentifizierung
  app.use('/announce', apiKeyAuth, announceRoutes);
  app.use('/divera', apiKeyAuth, diveraRoutes);
  app.use('/voices', voiceRoutes);

  // --- 404 Handler ---
  app.use(notFoundHandler);

  // --- Zentraler Error Handler (muss letzter Middleware sein) ---
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
