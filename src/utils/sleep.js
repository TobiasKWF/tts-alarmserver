'use strict';

/**
 * @file utils/sleep.js
 * @description Promisifizierter Sleep-Helper für async/await Flows.
 */

/**
 * Pausiert die Ausführung für die angegebene Anzahl Millisekunden.
 * @param {number} ms - Millisekunden
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

module.exports = { sleep };
