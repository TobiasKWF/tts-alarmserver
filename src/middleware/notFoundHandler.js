'use strict';

/**
 * @file middleware/notFoundHandler.js
 * @description Behandelt alle nicht gefundenen Routen mit einer
 * strukturierten 404-Antwort.
 */

const { NotFoundError } = require('../errors');

/**
 * Middleware: Behandelt unbekannte Routen.
 * @type {import('express').RequestHandler}
 */
function notFoundHandler(req, res, next) {
  next(new NotFoundError(`Route nicht gefunden: ${req.method} ${req.originalUrl}`));
}

module.exports = { notFoundHandler };
