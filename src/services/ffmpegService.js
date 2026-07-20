'use strict';

/**
 * FFmpeg-Service.
 *
 * Aufgaben:
 *   1. WAV-Dateien zusammenführen (concat)
 *   2. WAV → RTP-kompatibles Format konvertieren (PCM µ-law / G.711)
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
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error('Keine WAV-Dateien zum Zusammenführen');
  }

  const { sampleRate, channels } = config.rtp;

  if (inputPaths.length === 1) {
    await runFfmpeg([
      '-y',
      '-i', inputPaths[0],
      '-ar', String(sampleRate),
      '-ac', String(channels),
      '-c:a', 'pcm_s16le',
      outputPath,
    ]);
    return;
  }

  const args = ['-y'];

  for (const inputPath of inputPaths) {
    args.push('-i', inputPath);
  }

  const filterInputs = inputPaths
    .map((_, index) =>
      `[${index}:a]aresample=${sampleRate},aformat=sample_fmts=s16:channel_layouts=mono[a${index}]`
    )
    .join(';');

  const concatInputs = inputPaths
    .map((_, index) => `[a${index}]`)
    .join('');

  const filterGraph =
    `${filterInputs};${concatInputs}concat=n=${inputPaths.length}:v=0:a=1[aout]`;

  args.push(
    '-filter_complex', filterGraph,
    '-map', '[aout]',
    '-c:a', 'pcm_s16le',
    '-ar', String(sampleRate),
    '-ac', String(channels),
    outputPath,
  );

  await runFfmpeg(args);
}

/**
 * Konvertiert eine WAV-Datei in das RTP-Streamformat.
 * Standard: PCM µ-law (G.711), 8 kHz, mono.
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
