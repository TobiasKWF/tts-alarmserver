'use strict';

/**
 * @file services/piperService.js
 * @description Piper TTS – Wandelt Text in WAV-Audio um.
 *
 * Ruft das Piper-Binary als Child-Process auf und schreibt die Ausgabe
 * in eine temporäre WAV-Datei. Unterstützt mehrere Stimmen und
 * Sprechgeschwindigkeit.
 *
 * Piper-Aufruf:
 *   echo "Text" | piper --model <voice>.onnx --output_file <out>.wav
 *                        [--length_scale <speed>]
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const config = require('../config');
const logger = require('../utils/logger').child({ service: 'PiperService' });

/** @type {PiperService|null} */
let instance = null;

class PiperService {
  constructor() {
    this._binary = config.piper.binary;
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
   *
   * @param {object} opts
   * @param {string} opts.text        - Zu sprechender Text (bereits normalisiert)
   * @param {string} opts.voice       - Voice-Name (ohne Pfad und Extension)
   * @param {number} [opts.speed=1.0] - Sprechgeschwindigkeit (length_scale)
   * @param {string} opts.outputFile  - Ziel-WAV-Dateiname (absoluter Pfad)
   * @returns {Promise<void>}
   * @throws {PiperError} Bei Fehler im Piper-Prozess
   */
  async synthesize({ text, voice, speed = 1.0, outputFile }) {
    const modelFile = this._resolveModel(voice);

    logger.debug('Piper TTS gestartet', { voice, modelFile, outputFile, textLength: text.length });

    await this._runPiper({ text, modelFile, speed, outputFile });

    // Sicherstellen dass die Ausgabedatei existiert und nicht leer ist
    if (!fs.existsSync(outputFile)) {
      throw Object.assign(
        new Error(`Piper hat keine Ausgabedatei erzeugt: ${outputFile}`),
        { code: 'PIPER_NO_OUTPUT' }
      );
    }

    const stat = fs.statSync(outputFile);
    if (stat.size === 0) {
      throw Object.assign(
        new Error(`Piper hat eine leere WAV-Datei erzeugt: ${outputFile}`),
        { code: 'PIPER_EMPTY_OUTPUT' }
      );
    }

    logger.debug('Piper TTS abgeschlossen', { outputFile, sizeBytes: stat.size });
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
      .map((f) => f.replace(/\.onnx$/, ''));
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Ermittelt den absoluten Pfad zur ONNX-Modelldatei.
   * @param {string} voice
   * @returns {string}
   * @throws {Error} Wenn das Modell nicht gefunden wird
   */
  _resolveModel(voice) {
    // Unterstütze absoluten Pfad, relativen Pfad und nur den Namen
    if (path.isAbsolute(voice) && fs.existsSync(voice)) return voice;

    const candidates = [
      voice,
      path.join(this._voicesDir, voice),
      path.join(this._voicesDir, `${voice}.onnx`),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    throw Object.assign(
      new Error(`Piper-Stimme nicht gefunden: ${voice} (Suchpfade: ${candidates.join(', ')})`),
      { code: 'PIPER_VOICE_NOT_FOUND', statusCode: 400 }
    );
  }

  /**
   * Führt den Piper-Prozess aus.
   * Text wird via stdin übergeben.
   *
   * @param {object} opts
   * @returns {Promise<void>}
   */
  _runPiper({ text, modelFile, speed, outputFile }) {
    return new Promise((resolve, reject) => {
      const args = [
        '--model', modelFile,
        '--output_file', outputFile,
        '--length_scale', String(speed),
        '--sentence_silence', '0.3',
      ];

      logger.debug('Piper spawn', { binary: this._binary, args });

      const proc = spawn(this._binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        reject(Object.assign(
          new Error(`Piper konnte nicht gestartet werden: ${err.message}`),
          { code: 'PIPER_SPAWN_ERROR', cause: err }
        ));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(Object.assign(
            new Error(`Piper beendet mit Exit-Code ${code}: ${stderr.slice(0, 500)}`),
            { code: 'PIPER_EXIT_ERROR', exitCode: code, stderr }
          ));
          return;
        }
        resolve();
      });

      // Text via stdin senden
      proc.stdin.write(text, 'utf-8');
      proc.stdin.end();
    });
  }
}

module.exports = { PiperService };
