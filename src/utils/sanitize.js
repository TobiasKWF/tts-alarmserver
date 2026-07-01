'use strict';

/**
 * @file utils/sanitize.js
 * @description Hilfsfunktionen zur Bereinigung von Text für TTS und Logging.
 */

/**
 * Bereinigt einen Text für die sichere Verwendung in Shell-Befehlen.
 * Entfernt alle nicht erlaubten Zeichen.
 * @param {string} text
 * @returns {string}
 */
function sanitizeForShell(text) {
  if (typeof text !== 'string') return '';
  // Nur alphanumerische Zeichen, Leerzeichen, Umlaute und übliche Satzzeichen
  return text.replace(/[^a-zA-Z0-9äöüÄÖÜß\s.,!?;:()\/\-]/g, '');
}

/**
 * Kürzt einen String auf eine maximale Länge.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(text, maxLength = 500) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Normalisiert Leerzeichen und Zeilenumbrüche.
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespace(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim();
}

module.exports = { sanitizeForShell, truncate, normalizeWhitespace };
