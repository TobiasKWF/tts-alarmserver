'use strict';

/**
 * @file services/piperDaemon.js
 * @description Persistenter Piper-Prozess (Daemon-Modus).
 *
 * Piper wird einmal gestartet und bleibt am Leben.
 * Das ONNX-Modell wird NUR einmal geladen (~2-3s beim ersten Start),
 * danach kostet jede Synthese nur noch reine CPU-Zeit (~0.5-2s).
 *
 * Piper wird mit --json-input --output-raw aufgerufen:
 *   - stdin: JSON-Zeilen  { "text": "...", "output_file": "..." }
 *     (output_file wird ignoriert wenn --output-raw gesetzt)
 *   - stdout: Raw PCM (16-bit signed LE, 22050 Hz mono) - wird zu WAV konvertiert
 *   - stderr: Fortschritts-/Debug-Ausgabe
 *
 * API:
 *   const daemon = PiperDaemon.getInstance();
 *   const wavPath = await daemon.synthesize('Hallo Welt');
 */

const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');
const config     = require('../config');
const logger     = require('../logging/logger');
const { makeTempPath, ensureTmpDir } = require('../utils/tempFiles');

// Raw-PCM Parameter die Piper mit thorsten-Stimmen ausgibt
const PCM_SAMPLE_RATE  = 16000;
const PCM_CHANNELS     = 1;
const PCM_BIT_DEPTH    = 16;

/** Baut einen WAV-RIFF-Header für Raw-PCM-Daten. */
function buildWavHeader(pcmLength) {
  const byteRate    = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BIT_DEPTH / 8);
  const blockAlign  = PCM_CHANNELS * (PCM_BIT_DEPTH / 8);
  const buf         = Buffer.alloc(44);

  buf.write('RIFF',             0);
  buf.writeUInt32LE(36 + pcmLength, 4);
  buf.write('WAVE',             8);
  buf.write('fmt ',            12);
  buf.writeUInt32LE(16,         16);  // PCM chunk size
  buf.writeUInt16LE(1,          20);  // PCM format
  buf.writeUInt16LE(PCM_CHANNELS,     22);
  buf.writeUInt32LE(PCM_SAMPLE_RATE,  24);
  buf.writeUInt32LE(byteRate,   28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(PCM_BIT_DEPTH,    34);
  buf.write('data',             36);
  buf.writeUInt32LE(pcmLength,  40);
  return buf;
}

class PiperDaemon {
  constructor() {
    this._proc        = null;
    this._ready       = false;
    this._queue       = [];      // ausstehende Synthese-Aufträge
    this._current     = null;    // laufender Auftrag
    this._pcmBufs     = [];      // PCM-Daten des laufenden Auftrags
    this._restarts    = 0;
    this._maxRestarts = 10;
    this._starting    = false;
  }

  static getInstance() {
    if (!PiperDaemon._instance) {
      PiperDaemon._instance = new PiperDaemon();
    }
    return PiperDaemon._instance;
  }

  /** Startet den Piper-Prozess (idempotent). */
  async start() {
    if (this._proc || this._starting) return;
    this._starting = true;

    const args = [
      '--model',         config.piper.model,
      '--length-scale',  String(config.piper.lengthScale),
      '--noise-scale-w', String(config.piper.noiseScaleW),
      '--json-input',
      '--output-raw',
    ];

    logger.info(`PiperDaemon: starte Prozess: ${config.piper.binary} ${args.join(' ')}`);

    this._proc = spawn(config.piper.binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._pcmBufs = [];

    this._proc.stdout.on('data', (chunk) => {
      if (this._current) {
        this._pcmBufs.push(chunk);
      }
    });

    this._proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      // Piper gibt "Real-time factor" aus wenn fertig
      if (msg.includes('Real-time factor') || msg.includes('Inference seconds')) {
        this._onSynthesisDone();
      } else {
        logger.debug(`PiperDaemon stderr: ${msg}`);
      }
    });

    this._proc.on('close', (code) => {
      logger.warn(`PiperDaemon: Prozess beendet (code=${code})`);
      this._proc    = null;
      this._ready   = false;
      this._starting = false;

      // Laufenden Auftrag mit Fehler abschließen
      if (this._current) {
        this._current.reject(new Error(`Piper-Prozess unerwartet beendet (code=${code})`));
        this._current = null;
        this._pcmBufs = [];
      }

      // Neustart mit Backoff
      if (this._restarts < this._maxRestarts) {
        const delay = Math.min(1000 * Math.pow(2, this._restarts), 30000);
        this._restarts++;
        logger.info(`PiperDaemon: Neustart in ${delay}ms (Versuch ${this._restarts})`);
        setTimeout(() => this.start(), delay);
      } else {
        logger.error('PiperDaemon: Maximale Neustarts erreicht – Daemon deaktiviert.');
        // Alle wartenden Aufträge ablehnen
        for (const job of this._queue) {
          job.reject(new Error('PiperDaemon: Daemon nicht verfügbar'));
        }
        this._queue = [];
      }
    });

    this._proc.on('error', (err) => {
      logger.error(`PiperDaemon: Prozessfehler: ${err.message}`);
      this._starting = false;
    });

    // Kurze Wartezeit damit Piper das Modell lädt
    await new Promise(resolve => setTimeout(resolve, 100));
    this._ready   = true;
    this._starting = false;
    this._restarts = 0;
    logger.info('PiperDaemon: bereit.');

    // Wartende Aufträge abarbeiten
    this._processQueue();
  }

  /** Wird aufgerufen wenn Piper stderr "Real-time factor" ausgibt = fertig. */
  _onSynthesisDone() {
    if (!this._current) return;

    const job      = this._current;
    const pcmData  = Buffer.concat(this._pcmBufs);
    this._current  = null;
    this._pcmBufs  = [];

    if (pcmData.length === 0) {
      job.reject(new Error('PiperDaemon: Keine PCM-Daten empfangen'));
      this._processQueue();
      return;
    }

    // PCM -> WAV schreiben
    const header = buildWavHeader(pcmData.length);
    fs.writeFile(job.outPath, Buffer.concat([header, pcmData]), (err) => {
      if (err) {
        job.reject(new Error(`PiperDaemon: WAV-Schreiben fehlgeschlagen: ${err.message}`));
      } else {
        logger.debug(`PiperDaemon: WAV geschrieben: ${job.outPath} (${pcmData.length} bytes PCM)`);
        job.resolve(job.outPath);
      }
      this._processQueue();
    });
  }

  /** Nächsten Job aus der Queue starten. */
  _processQueue() {
    if (this._current || this._queue.length === 0) return;
    if (!this._proc || !this._ready) {
      this.start();
      return;
    }

    const job     = this._queue.shift();
    this._current = job;
    this._pcmBufs = [];

    const payload = JSON.stringify({ text: job.text }) + '\n';
    logger.debug(`PiperDaemon: sende Text (${job.text.length} Zeichen)`);

    try {
      this._proc.stdin.write(payload, 'utf8');
    } catch (err) {
      this._current = null;
      job.reject(new Error(`PiperDaemon: stdin-Schreibfehler: ${err.message}`));
      this._processQueue();
    }
  }

  /**
   * Synthetisiert Text zu einer WAV-Datei.
   * @param {string} text
   * @returns {Promise<string>} Pfad zur WAV-Datei
   */
  async synthesize(text) {
    await ensureTmpDir();
    const outPath = makeTempPath('.wav');

    if (!this._proc || !this._ready) {
      await this.start();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Timeout: Job aus Queue entfernen falls noch nicht gestartet
        const idx = this._queue.indexOf(job);
        if (idx !== -1) this._queue.splice(idx, 1);
        if (this._current === job) {
          this._current = null;
          this._pcmBufs = [];
        }
        reject(new Error(`PiperDaemon: Timeout nach ${config.piper.timeoutMs}ms`));
        this._processQueue();
      }, config.piper.timeoutMs);

      const job = {
        text,
        outPath,
        resolve: (p) => { clearTimeout(timer); resolve(p); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      };

      this._queue.push(job);
      this._processQueue();
    });
  }

  /** Beendet den Daemon sauber. */
  stop() {
    this._maxRestarts = 0;
    if (this._proc) {
      this._proc.stdin.end();
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
  }
}

PiperDaemon._instance = null;

module.exports = PiperDaemon;
