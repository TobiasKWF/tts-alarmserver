'use strict';

/**
 * Verwaltung temporärer Dateien.
 * Stellt sicher, dass bei Fehlern keine Dateileichen zurückbleiben.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../logging/logger');

/**
 * Erzeugt einen eindeutigen temporären Dateipfad.
 * @param {string} suffix  - Dateiendung inkl. Punkt (z.B. '.wav')
 * @returns {string}
 */
function makeTempPath(suffix) {
  const name = crypto.randomBytes(12).toString('hex') + suffix;
  return path.join(config.tmpDir, name);
}

/**
 * Stellt sicher, dass das TMP-Verzeichnis existiert.
 */
async function ensureTmpDir() {
  await fs.mkdir(config.tmpDir, { recursive: true });
}

/**
 * Löscht eine temporäre Datei; protokolliert Fehler, wirft sie aber nicht.
 * @param {string} filePath
 */
async function removeTempFile(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(`Temp-Datei konnte nicht gelöscht werden: ${filePath}`, { error: err.message });
    }
  }
}

/**
 * Löscht mehrere temporäre Dateien.
 * @param {string[]} paths
 */
async function removeTempFiles(paths) {
  await Promise.all(paths.map(removeTempFile));
}

module.exports = { makeTempPath, ensureTmpDir, removeTempFile, removeTempFiles };
