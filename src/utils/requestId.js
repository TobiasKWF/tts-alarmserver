'use strict';

/**
 * Generiert eine kurze, eindeutige Request-ID für Logging und Tracing.
 */

const crypto = require('crypto');

/**
 * @returns {string} z.B. "a3f9c1"
 */
function generateRequestId() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = { generateRequestId };
