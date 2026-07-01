'use strict';

/**
 * @file services/alarmService.js
 * @description Zentraler Alarm-Koordinator.
 * Empfängt Alarm-Payloads, startet die Audio-Pipeline und
 * kommuniziert Zustandsänderungen über den Event-Bus.
 * Kennt weder Routes noch WebSocket direkt – nur Events und Pipeline.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger').child({ service: 'AlarmService' });
const eventBus = require('../events/eventBus');
const config = require('../config');
const { PiperError, StreamError, ServiceUnavailableError } = require('../errors');
const { sleep } = require('../utils/sleep');
const { normalizeText } = require('../utils/normalize');
const HistoryService = require('./historyService');

/**
 * @typedef {object} AlarmPayload
 * @property {string} id - Eindeutige Alarm-ID (UUID)
 * @property {string} text - Anzusagender Text (bereits aufbereitet oder roh)
 * @property {string} [voice] - Stimme (Dateiname ohne .onnx)
 * @property {number} [priority=5] - Priorität 1–10
 * @property {number} [speed] - Sprechgeschwindigkeit (überschreibt Konfiguration)
 * @property {number} [volume] - Lautstärke 0–100
 * @property {boolean} [gong=true] - Gong vor der Ansage abspielen
 * @property {boolean} [normalize=true] - Feuerwehr-Normalisierung anwenden
 * @property {string} [source='api'] - Quelle (api|divera|fanfare)
 * @property {string} [requestId] - HTTP-Request-ID zur Nachverfolgung
 */

class AlarmService {
  /** @type {AlarmService|null} */
  static #instance = null;

  /** @type {object|null} */
  #queueService = null;

  static getInstance() {
    if (!AlarmService.#instance) {
      AlarmService.#instance = new AlarmService();
    }
    return AlarmService.#instance;
  }

  /**
   * Dependency Injection: QueueService setzen.
   * @param {object} queueService
   */
  setQueueService(queueService) {
    this.#queueService = queueService;
  }

  /**
   * Nimmt eine neue Alarmierung entgegen, normalisiert den Text und
   * reiht sie in die Queue ein. Gibt sofort zurück (HTTP 202).
   *
   * @param {AlarmPayload} payload
   * @returns {{ id: string, position: number, queueSize: number }}
   */
  receive(payload) {
    if (!this.#queueService) {
      throw new ServiceUnavailableError('QueueService nicht initialisiert');
    }

    const id = uuidv4();
    const normalizedText = (payload.normalize !== false)
      ? normalizeText(payload.text)
      : payload.text;

    const alarmPayload = {
      ...payload,
      id,
      text: normalizedText,
      rawText: payload.text,
      voice: payload.voice || config.piper.defaultVoice,
      priority: Math.min(Math.max(payload.priority || config.queue.defaultPriority, 1), 10),
      speed: payload.speed || config.piper.speed,
      volume: payload.volume !== undefined ? payload.volume : config.piper.volume,
      gong: payload.gong !== false,
      source: payload.source || 'api',
      receivedAt: new Date().toISOString(),
    };

    logger.info('Alarm empfangen', {
      alarmId: id,
      text: normalizedText,
      rawText: payload.text,
      priority: alarmPayload.priority,
      source: alarmPayload.source,
      requestId: payload.requestId,
    });

    eventBus.emit('alarm.received', {
      alarmId: id,
      text: normalizedText,
      priority: alarmPayload.priority,
      source: alarmPayload.source,
    });

    const entry = this.#queueService.enqueue(alarmPayload);

    return {
      id,
      position: this.#queueService.size,
      queueSize: this.#queueService.size,
    };
  }

  /**
   * Verarbeitet einen Alarm aus der Queue:
   * 1. Gong abspielen (optional)
   * 2. Text via Piper in WAV wandeln
   * 3. WAV via FFmpeg als RTP streamen
   *
   * @param {AlarmPayload} alarm
   */
  async process(alarm) {
    logger.info('Alarm-Verarbeitung gestartet', {
      alarmId: alarm.id,
      text: alarm.text,
      voice: alarm.voice,
    });

    eventBus.emit('alarm.started', {
      alarmId: alarm.id,
      text: alarm.text,
      voice: alarm.voice,
      source: alarm.source,
    });

    const startTime = Date.now();
    const tmpWav = path.join(process.cwd(), 'tmp', `${alarm.id}.wav`);

    try {
      // tmp-Verzeichnis sicherstellen
      const tmpDir = path.join(process.cwd(), 'tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      // 1. Gong abspielen
      if (alarm.gong) {
        await this._playGong(alarm);
        await sleep(config.audio.gongDelayMs);
      }

      // 2. TTS: Text → WAV
      await this._runPiper(alarm, tmpWav);

      // 3. WAV → RTP streamen
      await this._streamRtp(alarm, tmpWav);

      // 4. Post-Delay
      await sleep(config.audio.postDelayMs);

      const durationMs = Date.now() - startTime;

      logger.info('Alarm erfolgreich verarbeitet', {
        alarmId: alarm.id,
        durationMs,
      });

      HistoryService.add({
        id: alarm.id,
        text: alarm.text,
        rawText: alarm.rawText,
        voice: alarm.voice,
        source: alarm.source,
        priority: alarm.priority,
        receivedAt: alarm.receivedAt,
        finishedAt: new Date().toISOString(),
        durationMs,
        success: true,
      });

      eventBus.emit('alarm.finished', {
        alarmId: alarm.id,
        durationMs,
        success: true,
      });
    } catch (err) {
      const durationMs = Date.now() - startTime;

      logger.error('Alarm-Verarbeitung fehlgeschlagen', {
        alarmId: alarm.id,
        error: err.message,
        stack: err.stack,
        durationMs,
      });

      HistoryService.add({
        id: alarm.id,
        text: alarm.text,
        rawText: alarm.rawText,
        voice: alarm.voice,
        source: alarm.source,
        priority: alarm.priority,
        receivedAt: alarm.receivedAt,
        finishedAt: new Date().toISOString(),
        durationMs,
        success: false,
        error: err.message,
      });

      throw err;
    } finally {
      // Temporäre WAV-Datei aufräumen
      try {
        if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
      } catch (cleanupErr) {
        logger.warn('WAV-Cleanup fehlgeschlagen', { file: tmpWav, error: cleanupErr.message });
      }
    }
  }

  /**
   * Spielt eine Gong-Datei über FFmpeg+RTP ab.
   * @param {AlarmPayload} alarm
   */
  async _playGong(alarm) {
    const gongDir = config.audio.gongDir;
    // Priorisierung: priority-spezifischer Gong → standard.wav → überspringen
    const candidates = [
      path.join(gongDir, `priority-${alarm.priority}.wav`),
      path.join(gongDir, 'standard.wav'),
      path.join(gongDir, 'gong.wav'),
    ];

    const gongFile = candidates.find((f) => fs.existsSync(f));
    if (!gongFile) {
      logger.debug('Keine Gong-Datei gefunden – Gong übersprungen', { gongDir });
      return;
    }

    logger.debug('Gong wird abgespielt', { file: gongFile, alarmId: alarm.id });

    await this._ffmpegPlayFile(gongFile, alarm.volume);
  }

  /**
   * Konvertiert Text zu WAV über Piper TTS.
   * @param {AlarmPayload} alarm
   * @param {string} outputWav - Pfad zur Ausgabedatei
   */
  async _runPiper(alarm, outputWav) {
    const voicesDir = config.piper.voicesDir;
    const modelFile = path.join(voicesDir, `${alarm.voice}.onnx`);
    const configFile = `${modelFile}.json`;

    if (!fs.existsSync(modelFile)) {
      throw new PiperError(`Voice-Modell nicht gefunden: ${alarm.voice}`, {
        model: modelFile,
        voicesDir,
      });
    }

    if (!fs.existsSync(configFile)) {
      throw new PiperError(`Voice-Config nicht gefunden: ${alarm.voice}`, {
        config: configFile,
      });
    }

    eventBus.emit('tts.started', { alarmId: alarm.id, voice: alarm.voice });

    await new Promise((resolve, reject) => {
      const args = [
        '--model', modelFile,
        '--config', configFile,
        '--output_file', outputWav,
        '--length_scale', String(1.0 / (alarm.speed || config.piper.speed)),
      ];

      logger.debug('Piper wird gestartet', {
        binary: config.piper.binary,
        args: args.join(' '),
        alarmId: alarm.id,
      });

      const piper = spawn(config.piper.binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';

      piper.stderr.on('data', (d) => { stderr += d.toString(); });

      piper.stdin.write(alarm.text);
      piper.stdin.end();

      const timeout = setTimeout(() => {
        piper.kill('SIGKILL');
        reject(new PiperError('Piper TTS Timeout', { text: alarm.text, stderr }));
      }, 30_000);

      piper.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new PiperError(`Piper exited with code ${code}`, { stderr, text: alarm.text }));
        } else {
          logger.debug('Piper TTS abgeschlossen', { alarmId: alarm.id, outputWav });
          eventBus.emit('tts.finished', { alarmId: alarm.id, voice: alarm.voice });
          resolve();
        }
      });

      piper.on('error', (err) => {
        clearTimeout(timeout);
        reject(new PiperError(`Piper konnte nicht gestartet werden: ${err.message}`, {
          binary: config.piper.binary,
        }));
      });
    });
  }

  /**
   * Streamt eine WAV-Datei via FFmpeg als RTP-Stream.
   * @param {AlarmPayload} alarm
   * @param {string} wavFile
   */
  async _streamRtp(alarm, wavFile) {
    if (!fs.existsSync(wavFile)) {
      throw new StreamError(`WAV-Datei nicht gefunden: ${wavFile}`);
    }

    const rtpUrl = `rtp://${config.rtp.host}:${config.rtp.port}?ttl=${config.rtp.ttl}`;

    eventBus.emit('stream.started', {
      alarmId: alarm.id,
      rtpUrl,
    });

    const volumeFilter = alarm.volume !== 100
      ? `volume=${alarm.volume / 100}`
      : null;

    const audioFilters = [volumeFilter].filter(Boolean).join(',');

    const ffmpegArgs = [
      '-re',
      '-i', wavFile,
      ...(audioFilters ? ['-af', audioFilters] : []),
      '-acodec', config.rtp.codec,
      '-ar', String(config.rtp.sampleRate),
      '-b:a', config.rtp.bitrate,
      '-f', 'rtp',
      rtpUrl,
    ];

    logger.debug('FFmpeg RTP-Stream gestartet', {
      alarmId: alarm.id,
      args: ffmpegArgs.join(' '),
      rtpUrl,
    });

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-y', ...ffmpegArgs], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });

      const timeout = setTimeout(() => {
        ffmpeg.kill('SIGKILL');
        reject(new StreamError('FFmpeg RTP Timeout', { rtpUrl, stderr }));
      }, (config.rtp.timeoutSec + 60) * 1000);

      ffmpeg.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          // FFmpeg Exit-Code 1 kann trotzdem erfolgreich sein (End of stream)
          if (stderr.includes('muxing overhead')) {
            logger.debug('FFmpeg abgeschlossen', { alarmId: alarm.id, code });
            eventBus.emit('stream.finished', { alarmId: alarm.id, rtpUrl });
            resolve();
          } else {
            reject(new StreamError(`FFmpeg exited with code ${code}`, { stderr, rtpUrl }));
          }
        } else {
          logger.debug('FFmpeg RTP-Stream abgeschlossen', { alarmId: alarm.id, code });
          eventBus.emit('stream.finished', { alarmId: alarm.id, rtpUrl });
          resolve();
        }
      });

      ffmpeg.on('error', (err) => {
        clearTimeout(timeout);
        reject(new StreamError(`FFmpeg konnte nicht gestartet werden: ${err.message}`));
      });
    });
  }

  /**
   * Spielt eine Audio-Datei über RTP ab (für Gong, Fanfare).
   * @param {string} file - Pfad zur Audiodatei
   * @param {number} [volume=100] - Lautstärke
   */
  async _ffmpegPlayFile(file, volume = 100) {
    const rtpUrl = `rtp://${config.rtp.host}:${config.rtp.port}?ttl=${config.rtp.ttl}`;

    const volumeFilter = volume !== 100 ? `volume=${volume / 100}` : null;
    const audioFilters = [volumeFilter].filter(Boolean).join(',');

    const ffmpegArgs = [
      '-re',
      '-i', file,
      ...(audioFilters ? ['-af', audioFilters] : []),
      '-acodec', config.rtp.codec,
      '-ar', String(config.rtp.sampleRate),
      '-b:a', config.rtp.bitrate,
      '-f', 'rtp',
      rtpUrl,
    ];

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-y', ...ffmpegArgs], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });

      const timeout = setTimeout(() => {
        ffmpeg.kill('SIGKILL');
        reject(new StreamError('FFmpeg Gong/Fanfare Timeout', { file }));
      }, 60_000);

      ffmpeg.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null && !stderr.includes('muxing overhead')) {
          reject(new StreamError(`FFmpeg (Gong) exited with code ${code}`, { stderr, file }));
        } else {
          resolve();
        }
      });

      ffmpeg.on('error', (err) => {
        clearTimeout(timeout);
        reject(new StreamError(`FFmpeg (Gong) Fehler: ${err.message}`));
      });
    });
  }
}

module.exports = { AlarmService };
