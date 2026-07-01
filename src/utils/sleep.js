'use strict';

/**
 * @file utils/sleep.js
 * @description Promise-basierter Sleep-Helfer.
 */

/**
 * Wartet eine definierte Anzahl Millisekunden.
 * @param {number} ms - Millisekunden
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { sleep };
