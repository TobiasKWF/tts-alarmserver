'use strict';

/**
 * @file middleware/requestLogger.js
 * @description HTTP-Request/Response-Logger.
 *
 * Loggt jede eingehende Anfrage und ihre Antwort strukturiert
 * in die requests.log (via Winston).
 *
 * Erfasst:
 *   - Methode, URL, Status-Code
 *   - Response-Zeit in ms
 *   - IP-Adresse
 *   - User-Agent
 *   - Content-Length
 *   - Request-ID (für Korrelation)
 *
 * Sensitive Endpunkte (z.B. /health bei hohem Traffic) können
 * über LOG_SKIP_HEALTH=true aus dem Log ausgeschlossen werden.
 */

const logger = require('../utils/logger').child({ service: 'RequestLogger' });

const skipHealth = process.env.LOG_SKIP_HEALTH === 'true';

/**
 * Express-Middleware: Loggt HTTP-Request und Response.
 * @type {import('express').RequestHandler}
 */
function requestLogger(req, res, next) {
  // Health-Check-Requests optional aus dem Log ausschließen
  if (skipHealth && req.path === '/health') {
    return next();
  }

  const startAt = process.hrtime.bigint();

  // Response-Hook: Wird aufgerufen sobald der Response-Header gesendet wird
  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - startAt;
    const durationMs = Number(durationNs) / 1_000_000;

    const logData = {
      requestId: req.requestId || 'unknown',
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'] || 'unknown',
      contentLength: res.getHeader('content-length') || 0,
      referrer: req.headers.referer || req.headers.referrer || '-',
    };

    // Log-Level nach Status-Code bestimmen
    if (res.statusCode >= 500) {
      logger.error('HTTP Request', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });

  // Auch abgebrochene Verbindungen erfassen
  res.on('close', () => {
    if (!res.writableEnded) {
      logger.warn('HTTP Request abgebrochen (Client getrennt)', {
        requestId: req.requestId || 'unknown',
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
      });
    }
  });

  next();
}

module.exports = { requestLogger };
