'use strict';

/**
 * @file middleware/requestId.js
 * @description Request-ID-Middleware.
 *
 * Weist jeder eingehenden Anfrage eine eindeutige UUID v4 zu.
 * Wenn der Client bereits einen X-Request-ID-Header mitsendet,
 * wird dieser übernommen (für Tracing über Systemgrenzen).
 *
 * Die ID wird:
 *   1. an req.requestId angehängt (für Services und Logger)
 *   2. im Response-Header X-Request-ID zurückgesendet
 *   3. in req.log (falls vorhanden) als Kontext gesetzt
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Validiert ob ein String eine gültige UUID v4 ist.
 * Verhindert Header-Injection durch bösartige Clients.
 *
 * @param {string} id
 * @returns {boolean}
 */
function isValidUuid(id) {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Express-Middleware: Weist jeder Anfrage eine Request-ID zu.
 * @type {import('express').RequestHandler}
 */
function requestId(req, res, next) {
  // Client-seitige Request-ID übernehmen wenn gültig (für Distributed Tracing)
  const clientId = req.headers['x-request-id'];
  const id = (clientId && isValidUuid(clientId)) ? clientId : uuidv4();

  // An Request-Objekt anhängen (für alle nachfolgenden Middleware und Handler)
  req.requestId = id;

  // Im Response-Header zurückschicken (ermöglicht Client-seitiges Tracing)
  res.setHeader('X-Request-ID', id);

  next();
}

module.exports = { requestId };
