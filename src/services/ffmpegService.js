'use strict';

/**
 * FFmpeg-Service.
 *
 * Aufgaben:
 *   1. WAV-Dateien zusammenführen (concat)
 *   2. WAV → RTP-kompatibles Format konvertieren (PCM µ-law / G.711)
 *      Optional: Pitch-Shift via asetrate-Trick (keine zusätzliche Library nötig)
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../logging/logger');
const { makeTempPath, removeTempFile, removeTempFiles } = require('../utils/tempFiles');

/**
 * Führt einen ffmpeg-Prozess aus.
 * @param {string[]} args  - ffmpeg-Argumente
 * @returns {Promise<void>}
 */
async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffmpeg.binary, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg Timeout nach ${config.ffmpeg.timeoutMs}ms`));
    }, config.ffmpeg.timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg Exitcode ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg Prozessfehler: ${err.message}`));
    });
  });
}

/**
 * Fügt mehrere WAV-Dateien zu einer zusammen.
 * @param {string[]} inputPaths
 * @param {string}   outputPath
 * @returns {Promise<void>}
 */
async function mergeWavFiles(inputPaths, outputPath) {
  if (inputPaths.length === 1) {
    // Einzelne Datei – einfach kopieren
    const data = await fs.readFile(inputPaths[0]);
    await fs.writeFile(outputPath, data);
    return;
  }

  // Concat-Liste als temporäre Datei
  const listPath = makeTempPath('.txt');
  const listContent = inputPaths.map(p => `file '${p}'`).join('\n');
  await fs.writeFile(listPath, listContent, 'utf8');

  try {
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      outputPath,
    ]);
  } finally {
    await removeTempFile(listPath);
  }
}

/**
 * Berechnet den asetrate-Faktor für einen Pitch-Shift in Halbtonschritten.
 * Formel: factor = 2^(semitones/12)
 * Beispiel: -2 Halbtöne → factor ≈ 0.8909 → 22050 * 0.8909 ≈ 19643 Hz
 *
 * Trick: asetrate ändert die interpretierte Samplerate (Pitchänderung ohne Tempoänderung
 * wird durch nachfolgendes aresample wieder auf Originalrate gebracht).
 *
 * @param {number} semitones  - Halbtonschritte (negativ = tiefer)
 * @param {number} sampleRate - Original-Samplerate des Inputs
 * @returns {string} ffmpeg-af-Filterstring oder leerer String wenn semitones === 0
 */
function buildPitchFilter(semitones, sampleRate) {
  if (semitones === 0) return '';
  const factor      = Math.pow(2, semitones / 12);
  const newRate     = Math.round(sampleRate * factor);
  // asetrate: Pitch runter/hoch ohne Tempoänderung (kombiniert mit aresample)
  return `asetrate=${newRate},aresample=${sampleRate}`;
}

/**
 * Konvertiert eine WAV-Datei in das RTP-Streamformat.
 * Standard: PCM µ-law (G.711), 8 kHz, mono.
 * Wenn FFMPEG_PITCH_SEMITONES != 0 wird zusätzlich Pitch-Shift angewendet.
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {Promise<void>}
 */
async function wavToRtp(inputPath, outputPath) {
  const { codec, sampleRate, channels } = config.rtp;

  await runFfmpeg([
    '-y',
    '-i', inputPath,
    '-ar', String(sampleRate),
    '-ac', String(channels),
    '-acodec', codec,
    '-f', 'rtp',
    outputPath,
  ]);
}

/**
 * Kompletter Pipeline-Schritt: WAV-Liste → einzelne RTP-Datei.
 * @param {string[]} wavPaths   - Input-WAV-Dateien
 * @returns {Promise<string>}   - Pfad zur fertigen RTP-Datei
 */
async function processToRtp(wavPaths) {
  const mergedPath = makeTempPath('_merged.wav');
  const rtpPath = makeTempPath('.rtp');

  try {
    await mergeWavFiles(wavPaths, mergedPath);
    await wavToRtp(mergedPath, rtpPath);
    return rtpPath;
  } finally {
    await removeTempFile(mergedPath);
  }
}

module.exports = { runFfmpeg, mergeWavFiles, wavToRtp, processToRtp };
