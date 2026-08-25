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
 * stdout: Raw PCM (16-bit signed LE, mono; Samplerate aus der Modell-Konfiguration)
 *   - stderr: Fortschritts-/Debug-Ausgabe
 *
 * API:
 *   const daemon = PiperDaemon.getInstance();
 *   const wavPath = await daemon.synthesize('Hallo Welt');
 */

const { spawn }  = require('child_process');
const fs         = require('fs');
const config     = require('../config');
const logger     = require('../logging/logger');
const { makeTempPath, ensureTmpDir } = require('../utils/tempFiles');

const PCM_SAMPLE_RATE = config.piper.outputSampleRate;
const PCM_CHANNELS     = 1;
const PCM_BIT_DEPTH    = 16;

function buildWavHeader(pcmLength) {
  const byteRate    = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BIT_DEPTH / 8);
  const blockAlign  = PCM_CHANNELS * (PCM_BIT_DEPTH / 8);
  const buf         = Buffer.alloc(44);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcmLength, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(PCM_CHANNELS, 22);
  buf.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(PCM_BIT_DEPTH, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcmLength, 40);
  return buf;
}

class PiperDaemon {
  constructor() {
    this._proc        = null;
    this._ready       = false;
    this._queue       = [];
    this._current     = null;
    this._pcmBufs     = [];
    this._restarts    = 0;
    this._maxRestarts = 10;
    this._starting    = false;
    this._synthesisDone = false;
    this._finishScheduled = false;
  }

  static getInstance() {
    if (!PiperDaemon._instance) {
      PiperDaemon._instance = new PiperDaemon();
    }
    return PiperDaemon._instance;
  }

  async start() {
    if (this._proc || this._starting) return;
    this._starting = true;

    const args = [
      '--model',        config.piper.model,
      '--length-scale', String(config.piper.lengthScale),
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
      if (msg.includes('Real-time factor') || msg.includes('Inference seconds')) {
        // stdout und stderr sind getrennte Pipes. Die Fertigmeldung auf stderr
        // kann daher vor dem letzten stdout-'data'-Event eintreffen. Erst nach
        // dem aktuellen Event-Loop-Durchlauf finalisieren und bei 0 Bytes noch
        // kurz auf nachgelieferte PCM-Daten warten.
        this._synthesisDone = true;
        this._scheduleSynthesisFinish();
      } else {
        logger.debug(`PiperDaemon stderr: ${msg}`);
      }
    });

    this._proc.on('close', (code) => {
      logger.warn(`PiperDaemon: Prozess beendet (code=${code})`);
      this._proc     = null;
      this._ready    = false;
      this._starting = false;

      if (this._current) {
        this._current.reject(new Error(`Piper-Prozess unerwartet beendet (code=${code})`));
        this._current = null;
        this._pcmBufs = [];
      }

      if (this._restarts < this._maxRestarts) {
        const delay = Math.min(1000 * Math.pow(2, this._restarts), 30000);
        this._restarts++;
        logger.info(`PiperDaemon: Neustart in ${delay}ms (Versuch ${this._restarts})`);
        setTimeout(() => this.start(), delay);
      } else {
        logger.error('PiperDaemon: Maximale Neustarts erreicht – Daemon deaktiviert.');
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

    await new Promise(resolve => setTimeout(resolve, 100));
    this._ready    = true;
    this._starting = false;
    this._restarts = 0;
    logger.info('PiperDaemon: bereit.');
    this._processQueue();
  }

  _scheduleSynthesisFinish() {
    if (this._finishScheduled || !this._current) return;
    this._finishScheduled = true;

    setImmediate(() => {
      this._finishScheduled = false;
      if (!this._current || !this._synthesisDone) return;

      if (this._pcmBufs.length > 0) {
        this._onSynthesisDone();
        return;
      }

      // Letzte stdout-Daten können wegen der getrennten Pipes noch ausstehen.
      setTimeout(() => {
        if (!this._current || !this._synthesisDone) return;
        this._onSynthesisDone();
      }, 25);
    });
  }

  _onSynthesisDone() {
    if (!this._current) return;

    const job     = this._current;
    const pcmData = Buffer.concat(this._pcmBufs);
    this._current = null;
    this._pcmBufs = [];
    this._synthesisDone = false;
    this._finishScheduled = false;

    if (pcmData.length === 0) {
      job.reject(new Error('PiperDaemon: Keine PCM-Daten empfangen'));
      this._processQueue();
      return;
    }

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

  _processQueue() {
    if (this._current || this._queue.length === 0) return;
    if (!this._proc || !this._ready) {
      this.start();
      return;
    }

    const job = this._queue.shift();
    this._current = job;
    this._pcmBufs = [];
    this._synthesisDone = false;
    this._finishScheduled = false;

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

  async synthesize(text) {
    await ensureTmpDir();
    const outPath = makeTempPath('.wav');

    if (!this._proc || !this._ready) {
      await this.start();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._queue.indexOf(job);
        if (idx !== -1) this._queue.splice(idx, 1);
        if (this._current === job) {
          this._current = null;
          this._pcmBufs = [];
          this._synthesisDone = false;
          this._finishScheduled = false;
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
