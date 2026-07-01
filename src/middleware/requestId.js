'use strict';

/**
 * @file middleware/requestId.js
 * @description Weist jeder HTTP-Anfrage eine eindeutige Request-ID zu.
 * Die ID wird im Request-Objekt gespeichert und in Antwort-Headern
 * zurückgeliefert für einfaches Tracing.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Middleware: Setzt eine Request-ID auf req.requestId.
 * Berücksichtigt X-Request-ID-Header (z.B. von einem Reverse-Proxy).
 * @type {import('express').RequestHandler}
 */
function requestIdMiddleware(req, res, next) {
  const existingId = req.headers['x-request-id'];
  req.requestId = existingId && /^[\w\-]{8,64}$/.test(existingId)
    ? existingId
    : uuidv4();

  res.setHeader('X-Request-ID', req.requestId);
  next();
}

module.exports = { requestIdMiddleware };
