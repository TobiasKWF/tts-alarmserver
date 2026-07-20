'use strict';

/**
 * Globale Express-Fehlerbehandlung.
 * Fängt alle nicht behandelten Fehler ab und gibt eine strukturierte Antwort zurück.
 * Der Server wird NICHT beendet.
 */

const logger = require('../logging/logger');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  logger.error(`Unbehandelter Fehler [${status}]: ${err.message}`, {
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(status).json({
    error: err.message || 'Interner Serverfehler',
    status,
  });
};
