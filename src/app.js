'use strict';

/**
 * @file app.js
 * @description Express Application Factory.
 *
 * Erstellt und konfiguriert die Express-Anwendung ohne sie zu starten.
 * Trennt Application-Setup von Server-Lifecycle sauber.
 *
 * Middleware-Reihenfolge (Reihenfolge ist semantisch relevant):
 *   1.  trust proxy          – korrekte IPs hinter Nginx/Traefik
 *   2.  CORS                 – vor allem anderen, damit OPTIONS korrekt beantwortet wird
 *   3.  Helmet               – Sicherheits-Header
 *   4.  Body-Parser          – JSON + URL-encoded
 *   5.  Sanitize             – nach Body-Parser, vor RequestId
 *   6.  RequestId            – UUID pro Request, Header-Propagation
 *   7.  RequestLogger        – strukturiertes HTTP-Logging
 *   8.  Global Rate-Limiter  – Schutz aller Endpunkte (außer /ws und /health)
 *   9.  Static Files         – Dashboard
 *  10.  Routes               – mit route-spezifischen Limitern und Auth
 *  11.  404 Handler
 *  12.  Error Handler        – muss letzter sein
 */

const express = require('express');
const helmet  = require('helmet');
const path    = require('path');

const config = require('./config');
const logger = require('./utils/logger');

// Middleware – alles über den Barrel-Export
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

// Routes
const announceRouter = require('./routes/announce');
const diveraRouter   = require('./routes/divera');
const healthRouter   = require('./routes/health');
const statsRouter    = require('./routes/stats');
const voicesRouter   = require('./routes/voices');

/**
 * Erstellt und konfiguriert die Express-Anwendung.
 * @returns {express.Application}
 */
function createApp() {
  const app = express();

  // --- 1. Trust Proxy ---
  // Nötig für korrekte req.ip hinter Nginx, Traefik, Caddy etc.
  // Wert 1 = genau einem vorgelagerten Proxy vertrauen.
  app.set('trust proxy', 1);

  // --- 2. CORS ---
  // Muss vor allem anderen kommen, damit OPTIONS-Preflight-Requests
  // sofort beantwortet werden (vor Helmet, Auth usw.).
  app.use(corsMiddleware);
  app.options('*', corsMiddleware); // Explizit alle Preflight-Requests behandeln

  // --- 3. Sicherheits-Header (Helmet) ---
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:  ["'self'"],
          scriptSrc:   ["'self'", "'unsafe-inline'"],
          styleSrc:    ["'self'", "'unsafe-inline'"],
          // WebSocket für das Live-Dashboard erlauben
          connectSrc:  ["'self'", 'ws:', 'wss:'],
          imgSrc:      ["'self'", 'data:'],
          fontSrc:     ["'self'", 'data:'],
          objectSrc:   ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Sonst schlägt WebSocket-Upgrade fehl
    })
  );

  // --- 4. Body-Parser ---
  // Limit auf 1 MB – TTS-Texte sind kurz, große Payloads abweisen.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // --- 5. Eingabe-Sanitisierung ---
  // Nach dem Body-Parser, vor RequestId, damit req.body sauber ist.
  app.use(sanitize);

  // --- 6. Request-ID ---
  // Muss früh kommen, damit Logger und Services die ID nutzen können.
  app.use(requestId);

  // --- 7. HTTP-Request-Logging ---
  app.use(requestLogger);

  // --- 8. Globaler Rate-Limiter ---
  // Gilt für alle Endpunkte außer /ws (WebSocket-Upgrade) und /health.
  // WebSocket-Upgrades sind keine normalen HTTP-Requests und dürfen nicht
  // durch den Rate-Limiter blockiert werden – das würde den Dashboard-
  // Live-Status dauerhaft auf "Offline" halten.
  app.use((req, res, next) => {
    if (req.path === '/ws' || req.path.startsWith('/health')) return next();
    return globalLimiter(req, res, next);
  });

  // --- 9. Statische Dateien (Dashboard) ---
  app.use(
    '/dashboard',
    express.static(path.join(__dirname, '..', 'public'), {
      maxAge: config.server.nodeEnv === 'production' ? '1h' : 0,
      index: 'index.html',
    })
  );

  // --- Root-Redirect auf Dashboard ---
  app.get('/', (_req, res) => {
    res.redirect('/dashboard');
  });

  // --- 10. API-Routes ---

  // Health-Check: öffentlich, kein Rate-Limit, kein Auth
  app.use('/health', healthRouter);

  // Stats & History: öffentlich lesbar, globaler Limiter genügt
  app.use('/stats', statsRouter);

  // Announce: API-Key-Auth + eigener Limiter
  app.use('/announce',    apiKeyAuth, announceLimiter, announceRouter);

  // Play-Fanfare: gleiche Absicherung wie /announce
  // Die Route /play-fanfare ist im announceRouter als POST /fanfare registriert.
  // Hier mounten wir den Router nochmals unter /play-fanfare für die API-Kompatibilität:
  app.post('/play-fanfare', apiKeyAuth, announceLimiter, (req, res, next) => {
    // Intern an /fanfare im announceRouter weiterleiten
    req.url = '/fanfare';
    announceRouter(req, res, next);
  });

  // Divera-Webhook: eigener Limiter, kein API-Key (Webhooks haben eigene Auth)
  app.use('/divera', diveraLimiter, diveraRouter);

  // Voices: GET öffentlich, POST nur mit API-Key (wird intern im Router geprüft)
  app.use('/voices', voicesRouter);

  // Alias /voice für POST (API-Kompatibilität)
  app.use('/voice', voicesRouter);

  // --- 11. 404 Handler ---
  app.use(notFoundHandler);

  // --- 12. Zentraler Error-Handler (MUSS letzter sein) ---
  app.use(errorHandler);

  logger.info('Express-App konfiguriert', {
    env: config.server.nodeEnv,
    routes: [
      'GET  /health',
      'GET  /stats',
      'GET  /stats/history',
      'POST /announce',
      'POST /play-fanfare',
      'POST /divera',
      'GET  /voices',
      'POST /voice',
      'GET  /dashboard',
      'WS   /ws',
    ],
  });

  return app;
}

module.exports = { createApp };
