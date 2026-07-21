'use strict';

/**
 * @file middleware/helmetMiddleware.js
 * @description Helmet-Konfiguration für sichere HTTP-Response-Header.
 *
 * Helmet setzt standardmäßig folgende Header:
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: SAMEORIGIN
 *   - Referrer-Policy: no-referrer
 *   - Cross-Origin-Opener-Policy: same-origin
 *   - Cross-Origin-Resource-Policy: same-origin
 *   - Origin-Agent-Cluster: ?1
 *   - X-DNS-Prefetch-Control: off
 *   - X-Download-Options: noopen
 *   - X-Permitted-Cross-Domain-Policies: none
 *
 * Projektspezifische Anpassungen:
 *   - contentSecurityPolicy: Deaktiviert, da das Dashboard inline-Scripts
 *     und WebSocket-Verbindungen zu dynamischen Hosts benötigt. CSP sollte
 *     bei Bedarf separat und gezielt konfiguriert werden.
 *   - crossOriginEmbedderPolicy: Deaktiviert, da WebSocket-Upgrades
 *     (ws://) von Browsern sonst blockiert werden können.
 */

const helmet = require('helmet');

/**
 * Konfiguriertes Helmet-Middleware.
 *
 * contentSecurityPolicy und crossOriginEmbedderPolicy sind deaktiviert,
 * da das Live-Dashboard WebSocket-Verbindungen und inline JavaScript
 * verwendet, die unter einer strikten CSP ohne projektspezifische
 * Whitelist nicht funktionieren würden.
 *
 * Alle anderen Helmet-Schutzmaßnahmen laufen mit ihren empfohlenen Defaults.
 *
 * @type {import('express').RequestHandler}
 */
const helmetMiddleware = helmet({
  // Deaktiviert – Dashboard benötigt inline-Scripts und WS-Verbindungen.
  // Bei Bedarf hier eine projektspezifische CSP-Policy eintragen.
  contentSecurityPolicy: false,

  // Deaktiviert – verhindert sonst WebSocket-Upgrades (ws://) im Browser.
  crossOriginEmbedderPolicy: false,
});

module.exports = { helmetMiddleware };
