'use strict';

/**
 * @file services/piperService.js
 * @description Piper TTS – Wandelt Text in WAV-Audio um.
 *
 * Ruft das Piper-Binary als Child-Process auf und schreibt die Ausgabe
 * in eine temporäre WAV-Datei. Unterstützt mehrere Stimmen,
 * Sprechgeschwindigkeit, Timeout und automatische Wiederholung.
 *
 * Piper-Aufruf:
 *   echo "Text" | piper --model <voice>.onnx --output_file <out>.wav
 *                        [--length_scale <speed>]
 *
 * Events (via EventBus):
 *   tts.started  { alarmId, voice, textLength }
 *   tts.finished { alarmId, voice, outputFile, sizeBytes, durationMs }
 *   tts.error    { alarmId, voice, error }
 */

const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');

const config   = require('../config');
const logger   = require('../utils/logger').child({ service: 'PiperService' });
const eventBus = require('../events/eventBus');
const { AppError } = require('../errors');

/** @type {PiperService|null} */
let instance = null;

class PiperService {
  constructor() {
    this._binary    = config.piper.binary;
    this._voicesDir = config.piper.voicesDir;
  }

  /**
   * Gibt die Singleton-Instanz zurück.
   * @returns {PiperService}
   */
  static getInstance() {
    if (!instance) instance = new PiperService();
    return instance;
  }

  /**
   * Erzeugt eine WAV-Datei aus dem übergebenen Text.
   * Versucht bei transientem Fehler bis zu config.piper.maxRetries mal erneut.
   *
   * @param {object} opts
   * @param {string} opts.text        - Zu sprechender Text (bereits normalisiert)
   * @param {string} opts.voice       - Voice-Name (ohne Pfad und Extension)
   * @param {number} [opts.speed]     - Sprechgeschwindigkeit (length_scale, Standard aus config)
   * @param {string} opts.outputFile  - Ziel-WAV-Dateiname (absoluter Pfad)
   * @param {string} [opts.alarmId]   - Alarm-ID für Events und Logging
   * @returns {Promise<void>}
   * @throws {AppError} Bei Fehler im Piper-Prozess
   */
  async synthesize({ text, voice, speed, outputFile, alarmId = 'unknown' }) {
    const effectiveSpeed = speed ?? config.piper.speed;
    const modelFile      = this._resolveModel(voice);
    const maxRetries     = config.piper.maxRetries;

    logger.info('TTS Synthese gestartet', { alarmId, voice, modelFile, textLength: text.length });
    eventBus.emit('tts.started', { alarmId, voice, textLength: text.length });

    const startMs = Date.now();
    let lastError;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        await this._runPiperWithTimeout({ text, modelFile, speed: effectiveSpeed, outputFile });
        this._assertOutputValid(outputFile);

        const stat       = fs.statSync(outputFile);
        const durationMs = Date.now() - startMs;

        logger.info('TTS Synthese abgeschlossen', { alarmId, voice, outputFile, sizeBytes: stat.size, durationMs });
        eventBus.emit('tts.finished', { alarmId, voice, outputFile, sizeBytes: stat.size, durationMs });
        return;

      } catch (err) {
        lastError = err;
        // Cleanup fehlerhafte Ausgabedatei
        if (fs.existsSync(outputFile)) {
          try { fs.unlinkSync(outputFile); } catch (_) { /* ignore */ }
        }

        if (attempt <= maxRetries) {
          logger.warn(`TTS Synthese fehlgeschlagen, Versuch ${attempt}/${maxRetries + 1}`, {
            alarmId, error: err.message,
          });
          // Kurze Pause vor Wiederholung
          await _sleep(500 * attempt);
        }
      }
    }

    // Alle Versuche erschöpft
    eventBus.emit('tts.error', { alarmId, voice, error: lastError.message });
    throw new AppError(
      `TTS Synthese nach ${maxRetries + 1} Versuchen fehlgeschlagen: ${lastError.message}`,
      { code: 'PIPER_SYNTHESIS_FAILED', cause: lastError, statusCode: 500 }
    );
  }

  /**
   * Gibt alle verfügbaren Stimmen im Voices-Verzeichnis zurück.
   * @returns {string[]} Array von Voice-Namen (ohne Extension)
   */
  listVoices() {
    if (!fs.existsSync(this._voicesDir)) {
      logger.warn('Voices-Verzeichnis nicht gefunden', { voicesDir: this._voicesDir });
      return [];
    }

    return fs.readdirSync(this._voicesDir)
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => f.replace(/\.onnx$/, ''))
      .sort();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Führt Piper mit Timeout aus.
   * @param {object} opts
   * @returns {Promise<void>}
   */
  async _runPiperWithTimeout({ text, modelFile, speed, outputFile }) {
    const timeoutMs = config.piper.timeoutMs;

    const piperPromise = this._runPiper({ text, modelFile, speed, outputFile });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new AppError(
          `Piper Timeout nach ${timeoutMs}ms überschritten`,
          { code: 'PIPER_TIMEOUT', statusCode: 500 }
        ));
      }, timeoutMs);
    });

    return Promise.race([piperPromise, timeoutPromise]);
  }

  /**
   * Ermittelt den absoluten Pfad zur ONNX-Modelldatei.
   * @param {string} voice
   * @returns {string}
   * @throws {AppError} Wenn das Modell nicht gefunden wird
   */
  _resolveModel(voice) {
    if (path.isAbsolute(voice) && fs.existsSync(voice)) return voice;

    const candidates = [
      voice,
      path.join(this._voicesDir, voice),
      path.join(this._voicesDir, `${voice}.onnx`),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    throw new AppError(
      `Piper-Stimme nicht gefunden: "${voice}" (Suchpfade: ${candidates.join(', ')})`,
      { code: 'PIPER_VOICE_NOT_FOUND', statusCode: 400 }
    );
  }

  /**
   * Prüft ob die Ausgabedatei existiert und nicht leer ist.
   * @param {string} outputFile
   */
  _assertOutputValid(outputFile) {
    if (!fs.existsSync(outputFile)) {
      throw new AppError(
        `Piper hat keine Ausgabedatei erzeugt: ${outputFile}`,
        { code: 'PIPER_NO_OUTPUT', statusCode: 500 }
      );
    }
    const stat = fs.statSync(outputFile);
    if (stat.size === 0) {
      throw new AppError(
        `Piper hat eine leere WAV-Datei erzeugt: ${outputFile}`,
        { code: 'PIPER_EMPTY_OUTPUT', statusCode: 500 }
      );
    }
  }

  /**
   * Führt den Piper-Prozess aus. Text wird via stdin übergeben.
   * @param {object} opts
   * @returns {Promise<void>}
   */
  _runPiper({ text, modelFile, speed, outputFile }) {
    return new Promise((resolve, reject) => {
      const args = [
        '--model',           modelFile,
        '--output_file',     outputFile,
        '--length_scale',    String(speed),
        '--sentence_silence','0.3',
      ];

      logger.debug('Piper spawn', { binary: this._binary, args });

      const proc = spawn(this._binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr  = '';
      let settled = false;

      const settle = (fn) => {
        if (settled) return;
        settled = true;
        fn();
      };

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        settle(() => reject(new AppError(
          `Piper konnte nicht gestartet werden: ${err.message}`,
          { code: 'PIPER_SPAWN_ERROR', cause: err, statusCode: 500 }
        )));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          settle(() => reject(new AppError(
            `Piper beendet mit Exit-Code ${code}: ${stderr.slice(0, 500)}`,
            { code: 'PIPER_EXIT_ERROR', statusCode: 500 }
          )));
          return;
        }
        settle(() => resolve());
      });

      // Text via stdin senden und schließen
      try {
        proc.stdin.write(text, 'utf-8');
        proc.stdin.end();
      } catch (err) {
        settle(() => reject(new AppError(
          `Piper stdin konnte nicht beschrieben werden: ${err.message}`,
          { code: 'PIPER_STDIN_ERROR', cause: err, statusCode: 500 }
        )));
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {number} ms */
const _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { PiperService };
