'use strict';

/**
 * @file middleware/corsMiddleware.js
 * @description CORS-Konfiguration für den Alarmserver.
 *
 * Standardmäßig werden nur Anfragen vom konfigurierten Ursprung erlaubt.
 * Im Development-Modus wird CORS vollständig geöffnet.
 *
 * Umgebungsvariablen:
 *   CORS_ORIGIN    – Erlaubter Origin (Default: "*" in dev, strikt in prod)
 *   CORS_ORIGINS   – Kommaseparierte Liste erlaubter Origins (Allowlist)
 *
 * WICHTIG: CORS darf niemals auf `false` gesetzt werden wenn kein expliziter
 * Origin konfiguriert ist – das blockiert WebSocket-Upgrades im Browser,
 * weil WS-Handshakes einen Origin-Header senden und CORS false alle
 * cross-origin Requests (inkl. same-host WS) ablehnt.
 * Fallback ist deshalb immer '*' (offen), nicht false (blockiert).
 */

const cors = require('cors');
const logger = require('../utils/logger').child({ service: 'CORS' });

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Erlaubte Origins aus Umgebungsvariablen lesen.
 * CORS_ORIGINS überschreibt CORS_ORIGIN wenn gesetzt.
 *
 * Gibt niemals `false` zurück – Fallback ist '*' um WebSocket-Upgrades
 * nicht zu blockieren wenn kein expliziter Origin konfiguriert ist.
 *
 * @returns {string|string[]}
 */
function resolveAllowedOrigins() {
  const multi = process.env.CORS_ORIGINS;
  if (multi) {
    return multi.split(',').map((o) => o.trim()).filter(Boolean);
  }
  const single = process.env.CORS_ORIGIN;
  if (single) return single;

  // Kein CORS_ORIGIN gesetzt: immer '*' als Fallback.
  // In Production sollte CORS_ORIGIN explizit in der .env gesetzt werden,
  // aber ein fehlender Wert darf den WebSocket-Handshake nicht blockieren.
  if (!isDev) {
    logger.warn('CORS_ORIGIN ist nicht gesetzt. CORS ist offen (*). Setze CORS_ORIGIN in der .env für Produktionsbetrieb.');
  }
  return '*';
}

const allowedOrigins = resolveAllowedOrigins();

/**
 * Origin-Validierungsfunktion für dynamische Allowlists.
 *
 * @param {string|null} origin
 * @param {function} callback
 */
function originValidator(origin, callback) {
  // Anfragen ohne Origin-Header (z.B. direkte API-Calls, curl) immer erlauben
  if (!origin) return callback(null, true);

  // Wildcard
  if (allowedOrigins === '*') return callback(null, true);

  // Array-Allowlist
  if (Array.isArray(allowedOrigins)) {
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    logger.warn('CORS: Anfrage von nicht erlaubtem Origin abgelehnt', { origin });
    return callback(new Error(`CORS: Origin nicht erlaubt: ${origin}`));
  }

  // Einzel-String
  if (allowedOrigins === origin) return callback(null, true);

  logger.warn('CORS: Anfrage von nicht erlaubtem Origin abgelehnt', { origin });
  return callback(new Error(`CORS: Origin nicht erlaubt: ${origin}`));
}

/**
 * Konfiguriertes CORS-Middleware.
 */
const corsMiddleware = cors({
  origin: Array.isArray(allowedOrigins) ? originValidator : allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  credentials: allowedOrigins !== '*',
  maxAge: 86400, // Preflight-Ergebnis 24h cachen
});

module.exports = { corsMiddleware };
