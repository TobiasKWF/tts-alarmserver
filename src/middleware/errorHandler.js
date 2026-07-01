'use strict';

/**
 * @file middleware/errorHandler.js
 * @description Zentraler Express Error-Handler.
 * Behandelt alle Fehler konsistent und gibt strukturierte JSON-Antworten zurück.
 * Unterscheidet zwischen operationalen Fehlern (AlarmServerError) und
 * unerwarteten Programmfehlern.
 */

const logger = require('../utils/logger');
const { AlarmServerError } = require('../errors');

/**
 * Zentraler Express Error-Handler (muss 4 Parameter haben).
 * @type {import('express').ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const requestId = req.requestId || 'unknown';

  if (err instanceof AlarmServerError) {
    // Operationaler Fehler – erwartet und behandelbar
    logger.warn('Operationaler Fehler', {
      requestId,
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      details: err.details,
    });

    return res.status(err.statusCode).json({
      ...err.toJSON(),
      requestId,
    });
  }

  // Unerwarteter Programm-Fehler
  logger.error('Unerwarteter Fehler', {
    requestId,
    message: err.message,
    stack: err.stack,
  });

  // In Production keine Stack-Traces nach außen geben
  const isDev = process.env.NODE_ENV !== 'production';

  return res.status(500).json({
    error: 'InternalServerError',
    code: 'INTERNAL_ERROR',
    message: isDev ? err.message : 'Ein interner Serverfehler ist aufgetreten.',
    ...(isDev && { stack: err.stack }),
    requestId,
  });
}

module.exports = { errorHandler };
