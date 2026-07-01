'use strict';

/**
 * @file middleware/rateLimiter.js
 * @description Rate-Limiting für alle API-Endpunkte.
 *
 * Drei Stufen:
 *   globalLimiter   – gilt für alle Routen (sehr großzügig)
 *   announceLimiter – gilt für POST /announce (Kernfunktion)
 *   diveraLimiter   – gilt für POST /divera (Webhook-Eingang)
 *
 * Konfiguration über Umgebungsvariablen:
 *   RATE_LIMIT_WINDOW_MS     – Zeitfenster in ms (Default: 60000 = 1 Minute)
 *   RATE_LIMIT_GLOBAL        – Max. Anfragen global (Default: 200)
 *   RATE_LIMIT_ANNOUNCE      – Max. Anfragen /announce (Default: 30)
 *   RATE_LIMIT_DIVERA        – Max. Anfragen /divera (Default: 60)
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger').child({ service: 'RateLimiter' });

/** Zeitfenster in Millisekunden. */
const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;

/**
 * Gemeinsamer Handler für überschrittene Limits.
 * Gibt eine strukturierte JSON-Antwort zurück.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
function rateLimitHandler(req, res) {
  logger.warn('Rate-Limit überschritten', {
    requestId: req.requestId,
    ip: req.ip,
    url: req.originalUrl,
    method: req.method,
  });

  res.status(429).json({
    error: 'RateLimitError',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Zu viele Anfragen. Bitte warte kurz und versuche es erneut.',
    retryAfterMs: windowMs,
    requestId: req.requestId || 'unknown',
  });
}

/**
 * Standard-Optionen die alle Limiter teilen.
 * @param {number} max
 * @returns {object}
 */
function baseOptions(max) {
  return {
    windowMs,
    max,
    standardHeaders: true,   // Rate limit info in `RateLimit-*` headers
    legacyHeaders: false,     // Disable `X-RateLimit-*` headers
    handler: rateLimitHandler,
    // Vertrauenswürdigen Proxies für IP-Erkennung nutzen
    // (wird in app.js via app.set('trust proxy', 1) aktiviert)
    keyGenerator: (req) => req.ip || 'unknown',
    skip: (req) => {
      // Health-Checks von Rate-Limiting ausschließen
      return req.path === '/health';
    },
  };
}

/**
 * Globaler Limiter – gilt für alle eingehenden Anfragen.
 * 200 Anfragen pro Minute pro IP.
 */
const globalLimiter = rateLimit(baseOptions(
  parseInt(process.env.RATE_LIMIT_GLOBAL, 10) || 200
));

/**
 * Announce-Limiter – gilt nur für POST /announce.
 * 30 Anfragen pro Minute pro IP.
 * Verhindert Missbrauch der TTS-Synthese-Pipeline.
 */
const announceLimiter = rateLimit(baseOptions(
  parseInt(process.env.RATE_LIMIT_ANNOUNCE, 10) || 30
));

/**
 * Divera-Limiter – gilt nur für POST /divera.
 * 60 Anfragen pro Minute pro IP (Webhooks können gehäuft kommen).
 */
const diveraLimiter = rateLimit(baseOptions(
  parseInt(process.env.RATE_LIMIT_DIVERA, 10) || 60
));

module.exports = { globalLimiter, announceLimiter, diveraLimiter };
