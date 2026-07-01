'use strict';

/**
 * @file services/alarmService.js
 * @description Zentraler Alarm-Orchestrator.
 *
 * Verarbeitet einen Alarm aus der Queue:
 *   1. Text normalisieren (Feuerwehr-Normalisierung)
 *   2. TTS via Piper erzeugen → WAV-Datei in tmp/
 *   3. Gong-Datei vorne einmischen (optional)
 *   4. Per ffmpeg als RTP-Stream senden
 *   5. Tmp-Datei aufräumen
 *   6. Events auf dem EventBus emittieren
 *
 * Services kennen sich gegenseitig nicht – AlarmService delegiert
 * an PiperService, MixerService und FFmpegService und koordiniert
 * nur den Ablauf.
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const logger = require('../utils/logger').child({ service: 'AlarmService' });
const eventBus = require('../events/eventBus');
const { normalizeText } = require('./normalizationService');
const { PiperService } = require('./piperService');
const { FFmpegService } = require('./ffmpegService');

/** @type {AlarmService|null} */
let instance = null;

/** Alarmhistorie (in-memory, max HISTORY_MAX_ENTRIES Einträge) */
const _history = [];

class AlarmService {
  constructor() {
    /** @type {QueueService|null} */
    this._queueService = null;

    /** @type {PiperService} */
    this._piperService = PiperService.getInstance();

    /** @type {FFmpegService} */
    this._ffmpegService = FFmpegService.getInstance();

    /** @type {number} */
    this._totalAlarms = 0;

    /** @type {number} */
    this._failedAlarms = 0;

    /** @type {object|null} Aktuell verarbeiteter Alarm */
    this._current = null;

    // tmp-Verzeichnis sicherstellen
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  }

  /**
   * Gibt die Singleton-Instanz zurück.
   * @returns {AlarmService}
   */
  static getInstance() {
    if (!instance) instance = new AlarmService();
    return instance;
  }

  /**
   * Setzt die QueueService-Referenz (Dependency Injection aus server.js).
   * @param {object} queueService
   */
  setQueueService(queueService) {
    this._queueService = queueService;
  }

  /**
   * Verarbeitet einen Alarm vollständig (wird vom QueueService aufgerufen).
   *
   * @param {AlarmPayload} payload
   * @returns {Promise<void>}
   */
  async process(payload) {
    const alarmId = payload.id || uuidv4();
    const startedAt = Date.now();

    this._current = { alarmId, text: payload.text, startedAt };
    this._totalAlarms++;

    logger.info('Alarm-Verarbeitung gestartet', { alarmId, text: payload.text });
    eventBus.emit('alarm.started', { alarmId, text: payload.text });

    const tmpFile = path.join(process.cwd(), 'tmp', `alarm-${alarmId}.wav`);

    try {
      // 1. Text normalisieren
      const normalizedText = normalizeText(payload.text);
      if (normalizedText !== payload.text) {
        logger.debug('Text normalisiert', { alarmId, original: payload.text, normalized: normalizedText });
      }

      // 2. Gong vorbereiten (optional)
      const gongFile = _resolveGongFile(payload.gong);

      // 3. TTS erzeugen
      eventBus.emit('tts.started', { alarmId, text: normalizedText });

      const voice = payload.voice || config.piper.defaultVoice;
      const speed = payload.speed || config.piper.speed;

      await this._piperService.synthesize({
        text: normalizedText,
        voice,
        speed,
        outputFile: tmpFile,
      });

      eventBus.emit('tts.finished', { alarmId });
      logger.debug('TTS erzeugt', { alarmId, tmpFile });

      // 4. RTP-Streaming
      const rtpTarget = _resolveRtpTarget(payload);

      eventBus.emit('stream.started', { alarmId, rtpTarget });

      await this._ffmpegService.streamToRtp({
        audioFile: tmpFile,
        gongFile,
        rtpHost: rtpTarget.host,
        rtpPort: rtpTarget.port,
        codec: payload.codec || config.rtp.codec,
        bitrate: payload.bitrate || config.rtp.bitrate,
        volume: payload.volume || config.piper.volume,
      });

      eventBus.emit('stream.finished', { alarmId });

      // 5. Historie pflegen
      const durationMs = Date.now() - startedAt;
      const historyEntry = {
        alarmId,
        text: payload.text,
        normalizedText,
        voice,
        rtpTarget,
        durationMs,
        status: 'success',
        finishedAt: new Date().toISOString(),
      };
      _addToHistory(historyEntry);

      logger.info('Alarm erfolgreich abgeschlossen', { alarmId, durationMs });
      eventBus.emit('alarm.finished', { alarmId, durationMs, status: 'success' });
    } catch (err) {
      this._failedAlarms++;
      const durationMs = Date.now() - startedAt;

      _addToHistory({
        alarmId,
        text: payload.text,
        status: 'failed',
        error: err.message,
        durationMs,
        finishedAt: new Date().toISOString(),
      });

      logger.error('Alarm fehlgeschlagen', { alarmId, error: err.message, stack: err.stack });
      eventBus.emit('alarm.failed', { alarmId, error: err.message });
      throw err;
    } finally {
      this._current = null;
      // Tmp-Datei aufräumen
      _cleanupFile(tmpFile);
    }
  }

  /**
   * Gibt Statistiken zurück.
   * @returns {object}
   */
  getStats() {
    return {
      totalAlarms: this._totalAlarms,
      failedAlarms: this._failedAlarms,
      current: this._current,
    };
  }

  /**
   * Gibt die Alarmhistorie zurück.
   * @param {number} [limit=50]
   * @returns {Array<object>}
   */
  getHistory(limit = 50) {
    return _history.slice(-Math.min(limit, config.history.maxEntries));
  }
}

// ---------------------------------------------------------------------------
// Modul-private Helfer
// ---------------------------------------------------------------------------

/**
 * Ermittelt die Gong-Datei basierend auf dem Payload.
 * @param {string|undefined} gong
 * @returns {string|null}
 */
function _resolveGongFile(gong) {
  if (!gong) return null;
  const gongPath = path.isAbsolute(gong)
    ? gong
    : path.join(config.audio.gongDir, gong.endsWith('.wav') ? gong : `${gong}.wav`);
  if (!fs.existsSync(gongPath)) {
    logger.warn('Gong-Datei nicht gefunden', { gongPath });
    return null;
  }
  return gongPath;
}

/**
 * Ermittelt das RTP-Ziel (Host + Port) aus dem Payload oder der Konfiguration.
 * @param {AlarmPayload} payload
 * @returns {{ host: string, port: number }}
 */
function _resolveRtpTarget(payload) {
  return {
    host: payload.rtpHost || config.rtp.host,
    port: payload.rtpPort || config.rtp.port,
  };
}

/**
 * Fügt einen Eintrag zur Alarmhistorie hinzu (FIFO, max HISTORY_MAX_ENTRIES).
 * @param {object} entry
 */
function _addToHistory(entry) {
  _history.push(entry);
  if (_history.length > config.history.maxEntries) {
    _history.shift();
  }
}

/**
 * Löscht eine temporäre Datei ohne Fehler zu werfen.
 * @param {string} filePath
 */
function _cleanupFile(filePath) {
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      logger.warn('Tmp-Datei konnte nicht gelöscht werden', { filePath, error: err.message });
    }
  });
}

/**
 * @typedef {object} AlarmPayload
 * @property {string}  [id]        - Request-ID (optional, wird erzeugt wenn fehlend)
 * @property {string}  text        - Zu sprechender Text
 * @property {string}  [voice]     - Piper-Stimme (override)
 * @property {number}  [speed]     - Sprechgeschwindigkeit
 * @property {number}  [volume]    - Lautstärke 0–100
 * @property {string}  [gong]      - Gong-Dateiname (ohne Pfad)
 * @property {string}  [rtpHost]   - RTP-Zieladresse (override)
 * @property {number}  [rtpPort]   - RTP-Zielport (override)
 * @property {string}  [codec]     - FFmpeg-Codec (override)
 * @property {string}  [bitrate]   - Bitrate (override)
 */

module.exports = { AlarmService, getHistory: () => _history };
