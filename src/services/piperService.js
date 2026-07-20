'use strict';

/**
 * Piper TTS Service.
 *
 * Nimmt einen Text-Chunk und erzeugt eine WAV-Datei.
 * Unterstützt Timeout und sauberes Cleanup bei Fehlern.
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const config = require('../config');
const logger = require('../logging/logger');
const { makeTempPath, removeTempFile } = require('../utils/tempFiles');
const { splitText } = require('../utils/textSplitter');

/**
 * Führt Piper für einen einzelnen Text-Chunk aus.
 * @param {string} text     - Zu sprechender Text (bereits optimiert)
 * @param {string} outPath  - Pfad zur Ausgabe-WAV
 * @returns {Promise<void>}
 */
async function runPiper(text, outPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--model', config.piper.model,
      '--output_file', outPath,
    ];

    const proc = spawn(config.piper.binary, args, {
      timeout: config.piper.timeoutMs,
    });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.stdin.write(text, 'utf8');
    proc.stdin.end();

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Piper Timeout nach ${config.piper.timeoutMs}ms`));
    }, config.piper.timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Piper Exitcode ${code}: ${stderr.trim()}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Piper Prozessfehler: ${err.message}`));
    });
  });
}

/**
 * Konvertiert einen Text in eine oder mehrere WAV-Dateien.
 * Teilt bei Bedarf auf (Piper max. chunk length).
 * @param {string} text
 * @returns {Promise<string[]>} Array von WAV-Dateipfaden
 */
async function textToWavFiles(text) {
  const chunks = splitText(text, config.piper.maxChunkLength);
  if (chunks.length === 0) throw new Error('Kein Text zum Sprechen');

  const paths = [];

  for (const chunk of chunks) {
    const outPath = makeTempPath('.wav');
    try {
      await runPiper(chunk, outPath);
      paths.push(outPath);
    } catch (err) {
      // Alle bisherigen Temp-Dateien aufräumen
      await Promise.all(paths.map(removeTempFile));
      throw err;
    }
  }

  return paths;
}

module.exports = { textToWavFiles, runPiper };
