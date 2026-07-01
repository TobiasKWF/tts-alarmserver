'use strict';

/**
 * @file services/historyService.js
 * @description In-Memory Alarmhistorie mit konfigurierbarer Größe.
 * Speichert die letzten N Alarmierungen mit Metadaten.
 * Wird von WebSocket und Stats-Route genutzt.
 */

const logger = require('../utils/logger').child({ service: 'HistoryService' });
const config = require('../config');

/** @type {Array<object>} */
let history = [];

/** @type {{ total: number, success: number, failed: number }} */
let stats = { total: 0, success: 0, failed: 0 };

/**
 * Fügt einen abgeschlossenen Alarm zur Historie hinzu.
 * @param {object} entry
 * @param {string} entry.id
 * @param {string} entry.text
 * @param {string} entry.rawText
 * @param {string} entry.voice
 * @param {string} entry.source
 * @param {number} entry.priority
 * @param {string} entry.receivedAt
 * @param {string} entry.finishedAt
 * @param {number} entry.durationMs
 * @param {boolean} entry.success
 * @param {string} [entry.error]
 */
function add(entry) {
  const maxEntries = config.history.maxEntries;

  history.unshift(entry); // Neueste zuerst

  if (history.length > maxEntries) {
    history = history.slice(0, maxEntries);
  }

  stats.total++;
  if (entry.success) {
    stats.success++;
  } else {
    stats.failed++;
  }

  logger.debug('Alarm zur Historie hinzugefügt', {
    alarmId: entry.id,
    success: entry.success,
    historySize: history.length,
  });
}

/**
 * Gibt alle Historieneinträge zurück (neueste zuerst).
 * @returns {Array<object>}
 */
function getAll() {
  return history;
}

/**
 * Gibt aggregierte Statistiken zurück.
 * @returns {{ total: number, success: number, failed: number, successRate: number }}
 */
function getStats() {
  return {
    ...stats,
    successRate: stats.total > 0
      ? Math.round((stats.success / stats.total) * 100)
      : 100,
  };
}

/**
 * Löscht die gesamte Historie (z.B. für Tests).
 */
function clear() {
  history = [];
  stats = { total: 0, success: 0, failed: 0 };
}

module.exports = { add, getAll, getStats, clear };
