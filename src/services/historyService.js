'use strict';

/**
 * History-Service – speichert die letzten N Alarmierungen im Speicher.
 * Wird für das Web-Dashboard verwendet.
 */

const config = require('../config');

const entries = [];

/**
 * Fügt einen Alarm-Eintrag hinzu.
 * @param {object} entry
 */
function add(entry) {
  entries.unshift({ ...entry, ts: new Date().toISOString() });
  if (entries.length > config.history.maxEntries) {
    entries.length = config.history.maxEntries;
  }
}

/**
 * Gibt alle gespeicherten Einträge zurück.
 * @returns {object[]}
 */
function getAll() {
  return entries.slice();
}

/**
 * Gibt die letzten N Einträge zurück.
 * @param {number} n
 * @returns {object[]}
 */
function getLast(n) {
  return entries.slice(0, n);
}

module.exports = { add, getAll, getLast };
