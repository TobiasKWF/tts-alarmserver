'use strict';

/**
 * Alarm-spezifisches Logging.
 * Jede Alarmierung bekommt eine strukturierte Log-Zeile mit allen relevanten Feldern.
 */

const logger = require('./logger');

/**
 * Loggt den Abschluss einer Alarmverarbeitung.
 * @param {object} entry
 * @param {string} entry.requestId   - Eindeutige ID des Requests
 * @param {number} entry.startTime   - Unix-Timestamp Beginn (ms)
 * @param {number} entry.endTime     - Unix-Timestamp Ende (ms)
 * @param {string} entry.cleanText   - Bereinigter Alarmtext
 * @param {string} entry.spokenText  - Tatsächlich gesprochener Text
 * @param {boolean} entry.success    - Erfolgreich?
 * @param {string} [entry.error]     - Fehlermeldung falls vorhanden
 */
function logAlarm(entry) {
  const duration = entry.endTime - entry.startTime;
  const level = entry.success ? 'info' : 'error';
  logger[level]('ALARM', {
    requestId: entry.requestId,
    durationMs: duration,
    success: entry.success,
    cleanText: entry.cleanText,
    spokenText: entry.spokenText,
    error: entry.error || null,
  });
}

module.exports = { logAlarm };
