'use strict';

/**
 * @file middleware/sanitize.js
 * @description Eingabe-Sanitisierung für alle API-Anfragen.
 *
 * Schützt vor:
 *   - Null-Byte-Injection (\x00 in Strings)
 *   - Übermäßig tiefer JSON-Verschachtelung (DoS)
 *   - Offensichtlich bösartigen Zeichenketten
 *
 * Greift NACH dem JSON-Parser (express.json()) und
 * normalisiert den Request-Body in-place.
 */

const logger = require('../utils/logger').child({ service: 'Sanitize' });

/** Maximale erlaubte JSON-Verschachtelungstiefe. */
const MAX_DEPTH = 10;

/** Maximale Länge für einzelne String-Werte im Body. */
const MAX_STRING_LENGTH = 10_000;

/**
 * Entfernt Null-Bytes aus einem String.
 * @param {string} str
 * @returns {string}
 */
function stripNullBytes(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x00/g, '');
}

/**
 * Rekursiv Strings im Objekt bereinigen.
 * Kürzt zu lange Strings und entfernt Null-Bytes.
 *
 * @param {*}      value  – zu bereinigender Wert
 * @param {number} depth  – aktuelle Rekursionstiefe
 * @returns {*}
 */
function sanitizeValue(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    // Zu tief verschachteltes Objekt → durch null ersetzen
    return null;
  }

  if (typeof value === 'string') {
    let cleaned = stripNullBytes(value);
    if (cleaned.length > MAX_STRING_LENGTH) {
      cleaned = cleaned.slice(0, MAX_STRING_LENGTH);
    }
    return cleaned;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const cleaned = {};
    for (const [key, val] of Object.entries(value)) {
      // Auch Keys bereinigen
      const cleanKey = typeof key === 'string' ? stripNullBytes(key) : key;
      cleaned[cleanKey] = sanitizeValue(val, depth + 1);
    }
    return cleaned;
  }

  // Zahlen, Booleans, null, undefined – unverändert zurückgeben
  return value;
}

/**
 * Express-Middleware: Bereinigt req.body in-place.
 * Läuft nur wenn req.body ein Objekt ist (nach express.json()).
 *
 * @type {import('express').RequestHandler}
 */
function sanitize(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    try {
      req.body = sanitizeValue(req.body);
    } catch (err) {
      logger.warn('Sanitize-Fehler', {
        requestId: req.requestId,
        error: err.message,
      });
      // Im Fehlerfall den Body verwerfen statt abzustürzen
      req.body = {};
    }
  }
  next();
}

module.exports = { sanitize };
