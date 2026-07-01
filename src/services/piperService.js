'use strict';

/**
 * @file services/piperService.js
 * @description Wrapper für den Piper TTS-Prozess.
 * Erzeugt WAV-Dateien aus Text via Piper CLI.
 * Emittiert tts.started, tts.finished, tts.failed Events.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger').child({ service: 'PiperService' });
const eventBus = require('../events/eventBus');
const config = require('../config');
const { PiperError } = require('../errors');

/**
 * Erzeugt eine WAV-Datei aus dem gegebenen Text via Piper TTS.
 * @param {object} params
 * @param {string} params.text - Einzusprechender Text
 * @param {string} [params.voice] - Piper-Stimme (Dateiname ohne .onnx)
 * @param {string} params.outputFile - Absoluter Pfad zur Ausgabe-WAV-Datei
 * @param {number} [params.speed] - Sprechgeschwindigkeit (0.5–2.0)
 * @param {string} [params.requestId] - Tracing-ID
 * @returns {Promise<void>}
 * @throws {PiperError}
 */
async function synthesize({ text, voice, outputFile, speed, requestId }) {
  const resolvedVoice = voice || config.piper.defaultVoice;
  const resolvedSpeed = speed || config.piper.speed;
  const modelFile = _resolveModelFile(resolvedVoice);

  // tmp-Verzeichnis sicherstellen
  const tmpDir = path.dirname(outputFile);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  logger.debug('Piper TTS starten', {
    voice: resolvedVoice,
    modelFile,
    outputFile,
    speed: resolvedSpeed,
    requestId,
    textLength: text.length,
  });

  eventBus.emit('tts.started', { voice: resolvedVoice, requestId });

  return new Promise((resolve, reject) => {
    const args = [
      '--model', modelFile,
      '--output_file', outputFile,
      '--length_scale', String(1.0 / resolvedSpeed), // Piper: length_scale = 1/speed
    ];

    const piper = spawn(config.piper.binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrOutput = '';

    piper.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    piper.on('error', (err) => {
      logger.error('Piper-Prozess konnte nicht gestartet werden', {
        error: err.message,
        binary: config.piper.binary,
        requestId,
      });
      eventBus.emit('tts.failed', { error: err.message, requestId });
      reject(new PiperError(`Piper-Binary nicht gefunden: ${config.piper.binary}`, {
        error: err.message,
        binary: config.piper.binary,
      }));
    });

    piper.on('close', (code) => {
      if (code !== 0) {
        const errMsg = `Piper beendet mit Code ${code}: ${stderrOutput.trim()}`;
        logger.error('Piper fehlgeschlagen', { code, stderr: stderrOutput.trim(), requestId });
        eventBus.emit('tts.failed', { error: errMsg, requestId });
        reject(new PiperError(errMsg, { exitCode: code, stderr: stderrOutput.trim() }));
        return;
      }

      if (!fs.existsSync(outputFile)) {
        const errMsg = 'Piper erzeugte keine Ausgabedatei';
        logger.error(errMsg, { outputFile, requestId });
        eventBus.emit('tts.failed', { error: errMsg, requestId });
        reject(new PiperError(errMsg, { outputFile }));
        return;
      }

      const stat = fs.statSync(outputFile);
      logger.debug('Piper TTS abgeschlossen', {
        outputFile,
        fileSizeBytes: stat.size,
        requestId,
      });

      eventBus.emit('tts.finished', { outputFile, fileSizeBytes: stat.size, requestId });
      resolve();
    });

    // Text via stdin übergeben
    piper.stdin.write(text);
    piper.stdin.end();
  });
}

/**
 * Listet alle verfügbaren Stimmen im voices-Verzeichnis auf.
 * @returns {string[]}
 */
function listVoices() {
  const voicesDir = config.piper.voicesDir;

  if (!fs.existsSync(voicesDir)) {
    logger.warn('Voices-Verzeichnis nicht gefunden', { voicesDir });
    return [];
  }

  return fs
    .readdirSync(voicesDir)
    .filter((f) => f.endsWith('.onnx'))
    .map((f) => f.replace('.onnx', ''));
}

/**
 * Prüft ob eine Stimme verfügbar ist.
 * @param {string} voice
 * @returns {boolean}
 */
function voiceExists(voice) {
  return listVoices().includes(voice);
}

/**
 * Löst den absoluten Pfad zur Modell-Datei auf.
 * @param {string} voice
 * @returns {string}
 * @throws {PiperError}
 */
function _resolveModelFile(voice) {
  const modelFile = path.join(config.piper.voicesDir, `${voice}.onnx`);

  if (!fs.existsSync(modelFile)) {
    throw new PiperError(`Piper-Modell nicht gefunden: ${voice}`, {
      voice,
      expectedPath: modelFile,
      availableVoices: listVoices(),
    });
  }

  return modelFile;
}

module.exports = { synthesize, listVoices, voiceExists };
