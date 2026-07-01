'use strict';

/**
 * @file middleware/apiKeyAuth.js
 * @description Optionale API-Key-Authentifizierung.
 * Wenn API_KEY in der Konfiguration gesetzt ist, müssen alle Anfragen
 * den Key als Bearer-Token oder als X-API-Key-Header übermitteln.
 * Ist kein API_KEY konfiguriert, ist der Endpunkt offen.
 */

const config = require('../config');
const { AuthenticationError } = require('../errors');
const logger = require('../utils/logger');

/**
 * Middleware: Prüft API-Key-Authentifizierung.
 * @type {import('express').RequestHandler}
 */
function apiKeyAuth(req, res, next) {
  // Wenn kein API-Key konfiguriert ist, Authentifizierung überspringen
  if (!config.server.apiKey) {
    return next();
  }

  // Key aus Authorization-Header (Bearer) oder X-API-Key-Header lesen
  let providedKey = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (req.headers['x-api-key']) {
    providedKey = req.headers['x-api-key'];
  }

  if (!providedKey || providedKey !== config.server.apiKey) {
    logger.warn('Authentifizierungsfehler: Ungültiger API-Key', {
      requestId: req.requestId,
      ip: req.ip,
      url: req.originalUrl,
    });
    return next(new AuthenticationError('Ungültiger oder fehlender API-Key'));
  }

  next();
}

module.exports = { apiKeyAuth };
