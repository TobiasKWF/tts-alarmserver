'use strict';

/**
 * @file services/alarmService.js
 * @description Zentraler Orchestrator für die Alarm-Wiedergabe.
 * Koordiniert PiperService, FFmpegService und Gong-Wiedergabe.
 * Pflegt die Alarm-Historie und emittiert alle Alarm-Events.
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger').child({ service: 'AlarmService' });
const eventBus = require('../events/eventBus');
const config = require('../config');
const { sleep } = require('../utils/sleep');
const { normalizeText } = require('../utils/normalizer');

/** @typedef {{ id: string, text: string, voice: string, priority: number, source: string, receivedAt: string, startedAt?: string, finishedAt?: string, status: 'queued'|'processing'|'finished'|'failed', error?: string }} HistoryEntry */

class AlarmService {
  /** @type {AlarmService|null} */
  static #instance = null;

  constructor() {
    /** @type {HistoryEntry[]} */
    this._history = [];
    this._totalCount = 0;
    this._errorCount = 0;
    /** @type {object|null} */
    this._queueService = null;
  }

  /**
   * @returns {AlarmService}
   */
  static getInstance() {
    if (!AlarmService.#instance) {
      AlarmService.#instance = new AlarmService();
    }
    return AlarmService.#instance;
  }

  /**
   * Setzt den QueueService (Dependency Injection).
   * @param {object} queueService
   */
  setQueueService(queueService) {
    this._queueService = queueService;
  }

  /**
   * Empfängt eine neue Alarmierung und reiht sie in die Queue ein.
   * Antwortet sofort (HTTP 202) – die Wiedergabe erfolgt asynchron.
   * @param {object} params
   * @param {string} params.text - Anzusagender Text
   * @param {string} [params.voice] - Piper-Stimme
   * @param {number} [params.priority] - Priorität 1-10
   * @param {string} [params.source] - Quelle der Alarmierung (z.B. 'api', 'divera')
   * @param {string} [params.gong] - Gong-Dateiname (ohne Pfad)
   * @param {string} [params.requestId] - Request-ID für Tracing
   * @returns {{ id: string, queued: boolean, queuePosition: number }}
   */
  receive({ text, voice, priority, source = 'api', gong, requestId }) {
    const id = uuidv4();

    /** @type {HistoryEntry} */
    const entry = {
      id,
      text,
      voice: voice || config.piper.defaultVoice,
      gong: gong || null,
      priority: priority || config.queue.defaultPriority,
      source,
      requestId: requestId || null,
      receivedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      status: 'queued',
      error: null,
    };

    this._addToHistory(entry);

    eventBus.emit('alarm.received', {
      id,
      text,
      source,
      priority: entry.priority,
      requestId,
    });

    const queueItem = this._queueService.enqueue(id, entry, entry.priority);
    const queuePosition = this._queueService.size;

    logger.info('Alarm empfangen und eingereiht', {
      id,
      source,
      priority: entry.priority,
      queuePosition,
      requestId,
    });

    return { id, queued: true, queuePosition };
  }

  /**
   * Verarbeitet einen Alarm aus der Queue.
   * Wird vom QueueService aufgerufen.
   * @param {object} queueItem
   */
  async process(queueItem) {
    const { id, payload } = queueItem;
    const PiperService = require('./piperService');
    const FFmpegService = require('./ffmpegService');

    this._updateHistory(id, { status: 'processing', startedAt: new Date().toISOString() });

    eventBus.emit('alarm.started', {
      id,
      text: payload.text,
      voice: payload.voice,
      source: payload.source,
    });

    let audioFile = null;

    try {
      // Normalisierung des Textes (Feuerwehr-Abkürzungen etc.)
      const normalizedText = normalizeText(payload.text);

      logger.info('Alarm-Wiedergabe startet', {
        id,
        originalText: payload.text,
        normalizedText,
        voice: payload.voice,
        source: payload.source,
      });

      // 1. Gong abspielen (falls konfiguriert)
      if (payload.gong) {
        await this._playGong(payload.gong, id);
        await sleep(config.audio.gongDelayMs);
      }

      // 2. TTS-Audio erzeugen
      const tmpFile = path.join(process.cwd(), 'tmp', `alarm_${id}.wav`);
      await PiperService.synthesize({
        text: normalizedText,
        voice: payload.voice || config.piper.defaultVoice,
        outputFile: tmpFile,
        speed: config.piper.speed,
        requestId: payload.requestId,
      });
      audioFile = tmpFile;

      // 3. Via RTP streamen
      await FFmpegService.streamRtp({
        inputFile: audioFile,
        rtpHost: config.rtp.host,
        rtpPort: config.rtp.port,
        bitrate: config.rtp.bitrate,
        codec: config.rtp.codec,
        ttl: config.rtp.ttl,
        requestId: payload.requestId,
      });

      // 4. Post-Delay
      if (config.audio.postDelayMs > 0) {
        await sleep(config.audio.postDelayMs);
      }

      this._updateHistory(id, { status: 'finished', finishedAt: new Date().toISOString() });
      this._totalCount++;

      eventBus.emit('alarm.finished', {
        id,
        text: payload.text,
        source: payload.source,
        durationMs: Date.now() - new Date(payload.receivedAt).getTime(),
      });

      logger.info('Alarm erfolgreich abgespielt', { id });
    } catch (err) {
      this._errorCount++;
      this._updateHistory(id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: err.message,
      });

      eventBus.emit('alarm.failed', { id, error: err.message });

      logger.error('Alarm-Wiedergabe fehlgeschlagen', {
        id,
        error: err.message,
        stack: err.stack,
      });

      throw err;
    } finally {
      // Temporäre Audio-Datei bereinigen
      if (audioFile) {
        fs.unlink(audioFile, (unlinkErr) => {
          if (unlinkErr && unlinkErr.code !== 'ENOENT') {
            logger.warn('Temp-Datei konnte nicht gelöscht werden', {
              file: audioFile,
              error: unlinkErr.message,
            });
          }
        });
      }
    }
  }

  /**
   * Spielt eine Gong-Datei über FFmpeg direkt ab.
   * @param {string} gongFile - Dateiname (ohne Pfad)
   * @param {string} alarmId
   */
  async _playGong(gongFile, alarmId) {
    const FFmpegService = require('./ffmpegService');
    const gongPath = path.join(config.audio.gongDir, gongFile);

    if (!fs.existsSync(gongPath)) {
      logger.warn('Gong-Datei nicht gefunden – übersprungen', { gongFile, gongPath, alarmId });
      return;
    }

    logger.debug('Gong wird abgespielt', { gongFile, alarmId });

    await FFmpegService.streamRtp({
      inputFile: gongPath,
      rtpHost: config.rtp.host,
      rtpPort: config.rtp.port,
      bitrate: config.rtp.bitrate,
      codec: config.rtp.codec,
      ttl: config.rtp.ttl,
      requestId: alarmId,
    });
  }

  /**
   * Fügt einen Eintrag zur Historie hinzu.
   * @param {HistoryEntry} entry
   */
  _addToHistory(entry) {
    this._history.unshift(entry);
    if (this._history.length > config.history.maxEntries) {
      this._history.pop();
    }
  }

  /**
   * Aktualisiert einen bestehenden Historieneintrag.
   * @param {string} id
   * @param {Partial<HistoryEntry>} updates
   */
  _updateHistory(id, updates) {
    const entry = this._history.find((e) => e.id === id);
    if (entry) {
      Object.assign(entry, updates);
    }
  }

  /**
   * Gibt die Alarm-Historie zurück.
   * @param {number} [limit]
   * @returns {HistoryEntry[]}
   */
  getHistory(limit) {
    return limit ? this._history.slice(0, limit) : [...this._history];
  }

  /**
   * Gibt Statistiken zurück.
   * @returns {{ total: number, errors: number, queueSize: number, isProcessing: boolean }}
   */
  getStats() {
    return {
      total: this._totalCount,
      errors: this._errorCount,
      queueSize: this._queueService ? this._queueService.size : 0,
      isProcessing: this._queueService ? this._queueService.isProcessing : false,
      uptime: process.uptime(),
    };
  }

  /**
   * Setzt die Singleton-Instanz zurück (nur für Tests).
   */
  static _reset() {
    AlarmService.#instance = null;
  }
}

module.exports = { AlarmService };
