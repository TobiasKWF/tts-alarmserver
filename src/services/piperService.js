'use strict';

/**
 * @file services/piperService.js
 * @description Piper TTS Service – nutzt PiperDaemon für persistenten Prozess.
 *
 * Der Daemon hält einen laufenden Piper-Prozess am Leben.
 * Das Modell wird nur einmal beim ersten Aufruf geladen (~2-3s).
 * Folgealarme brauchen nur noch ~0.5-2s für die reine Synthese.
 */

const config      = require('../config');
const logger      = require('../logging/logger');
const PiperDaemon = require('./piperDaemon');
const { splitText } = require('../utils/textSplitter');
const { removeTempFile } = require('../utils/tempFiles');

/**
 * Konvertiert einen Text in eine oder mehrere WAV-Dateien via PiperDaemon.
 * @param {string} text
 * @returns {Promise<string[]>} Array von WAV-Dateipfaden
 */
async function textToWavFiles(text) {
  const chunks = splitText(text, config.piper.maxChunkLength);
  if (chunks.length === 0) throw new Error('Kein Text zum Sprechen');

  const daemon = PiperDaemon.getInstance();
  const paths  = [];

  for (const chunk of chunks) {
    try {
      const wavPath = await daemon.synthesize(chunk);
      paths.push(wavPath);
    } catch (err) {
      await Promise.all(paths.map(removeTempFile));
      throw err;
    }
  }

  return paths;
}

module.exports = { textToWavFiles };
