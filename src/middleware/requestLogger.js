'use strict';

/**
 * Express-Middleware: Loggt eingehende Requests.
 * Kein Logging von Request-Bodies (Datenschutz).
 */

const logger = require('../logging/logger');

module.exports = function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });
  next();
};
