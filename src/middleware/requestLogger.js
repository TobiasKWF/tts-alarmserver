'use strict';

/**
 * @file middleware/requestLogger.js
 * @description Strukturiertes HTTP-Request/Response-Logging mit Winston.
 * Loggt alle API-Aufrufe mit Timing, Status und Request-ID.
 */

const logger = require('../utils/logger');

/**
 * Middleware: Loggt eingehende Requests und deren Antworten strukturiert.
 * @type {import('express').RequestHandler}
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Log beim Response-Abschluss
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const logData = {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      userAgent: req.get('user-agent') || '',
      ip: req.ip || req.connection.remoteAddress,
      contentLength: res.get('content-length') || 0,
    };

    if (res.statusCode >= 500) {
      logger.error('HTTP Request fehlgeschlagen', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP Request Client-Fehler', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  });

  next();
}

module.exports = { requestLogger };
