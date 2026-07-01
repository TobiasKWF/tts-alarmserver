'use strict';

/**
 * @file services/alarmService.js
 * @description Zentraler Alarm-Orchestrator.
 *
 * Verarbeitet einen Alarm aus der Queue:
 *   1. Text normalisieren (Feuerwehr-Normalisierung)
 *   2. TTS via PiperService erzeugen → WAV-Datei in tmp/
 *   3. Gong-Datei vorne einmischen (optional)
 *   4. Per FFmpegService als RTP-Stream senden
 *   5. Tmp-Datei aufräumen
 *   6. Events auf dem EventBus emittieren (alarm.*)
 *
 * HINWEIS: tts.* und stream.* Events werden NICHT hier emittiert.
 * PiperService und FFmpegService emittieren diese selbst.
 * AlarmService emittiert nur alarm.started / alarm.finished / alarm.failed.
 *
 * Services kennen sich gegenseitig nicht – AlarmService delegiert
 * an PiperService und FFmpegService und koordiniert nur den Ablauf.
 */

const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');

const config      = require('../config');
const logger      = require('../utils/logger').child({ service: 'AlarmService' });
const eventBus    = require('../events/eventBus');
const { normalizeText } = require('./normalizationService');
const { PiperService }  = require('./piperService');
const { FFmpegService } = require('./ffmpegService');
const { PiperError, StreamError } = require('../errors');

/** @type {AlarmService|null} */
let instance = null;

/** Alarmhistorie (in-memory, FIFO, max config.history.maxEntries) */
const _history = [];

class AlarmService {
  constructor() {
    /** @type {PiperService} */
    this._piperService   = PiperService.getInstance();

    /** @type {FFmpegService} */
    this._ffmpegService  = FFmpegService.getInstance();

    /** @type {number} Gesamt-Zähler aller gestarteten Alarmierungen */
    this._totalAlarms    = 0;

    /** @type {number} Zähler fehlgeschlagener Alarmierungen */
    this._failedAlarms   = 0;

    /** @type {AlarmPayload|null} Aktuell verarbeiteter Alarm */
    this._current        = null;

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
   * Verarbeitet einen Alarm vollständig (wird vom QueueService aufgerufen).
   *
   * @param {AlarmPayload} payload
   * @returns {Promise<void>}
   */
  async process(payload) {
    const alarmId   = payload.id || uuidv4();
    const startedAt = Date.now();

    this._totalAlarms++;
    this._current = { alarmId, text: payload.text, startedAt, priority: payload.priority ?? 5 };

    const voice = payload.voice || config.piper.defaultVoice;

    logger.info('Alarm-Verarbeitung gestartet', { alarmId, voice, text: payload.text });
    eventBus.emit('alarm.started', { alarmId, text: payload.text, voice, priority: payload.priority ?? 5 });

    const tmpFile = path.join(process.cwd(), 'tmp', `alarm-${alarmId}.wav`);

    try {
      // 1. Text normalisieren
      const normalizedText = normalizeText(payload.text);
      if (normalizedText !== payload.text) {
        logger.debug('Text normalisiert', { alarmId, original: payload.text, normalized: normalizedText });
      }

      // 2. Gong vorbereiten (optional)
      const gongFile = _resolveGongFile(payload.gong, alarmId);

      // 3. TTS erzeugen
      //    tts.started / tts.finished werden von PiperService emittiert
      await this._piperService.synthesize({
        text:       normalizedText,
        voice,
        speed:      payload.speed  ?? config.piper.speed,
        outputFile: tmpFile,
        alarmId,
      });

      logger.debug('TTS erzeugt', { alarmId, tmpFile });

      // 4. RTP-Streaming
      //    stream.started / stream.finished werden von FFmpegService emittiert
      const rtpTarget = _resolveRtpTarget(payload);

      await this._ffmpegService.streamToRtp({
        audioFile: tmpFile,
        gongFile,
        rtpHost:   rtpTarget.host,
        rtpPort:   rtpTarget.port,
        codec:     payload.codec    || config.rtp.codec,
        bitrate:   payload.bitrate  || config.rtp.bitrate,
        volume:    payload.volume   ?? config.piper.volume,
        alarmId,
      });

      // 5. Historie + Events
      const durationMs = Date.now() - startedAt;

      _addToHistory({
        alarmId,
        text:          payload.text,
        normalizedText,
        voice,
        priority:      payload.priority ?? 5,
        rtpTarget,
        durationMs,
        status:        'success',
        finishedAt:    new Date().toISOString(),
      });

      logger.info('Alarm erfolgreich abgeschlossen', { alarmId, durationMs });
      eventBus.emit('alarm.finished', { alarmId, durationMs, status: 'success' });

    } catch (err) {
      this._failedAlarms++;
      const durationMs = Date.now() - startedAt;

      _addToHistory({
        alarmId,
        text:      payload.text,
        priority:  payload.priority ?? 5,
        status:    'failed',
        error:     err.message,
        code:      err.code,
        durationMs,
        finishedAt: new Date().toISOString(),
      });

      logger.error('Alarm fehlgeschlagen', {
        alarmId,
        errorCode:    err.code,
        errorMessage: err.message,
        stack:        err.stack,
      });
      eventBus.emit('alarm.failed', { alarmId, error: err.message, code: err.code });

      // Typed re-throw: Piper- und Stream-Fehler bleiben als solche
      // erkennbar für Middleware und QueueService.
      // Unbekannte Fehler werden eingewickelt damit isOperational stimmt.
      if (err.isOperational) throw err;
      throw new PiperError(`Unerwarteter Fehler in AlarmService: ${err.message}`, { cause: err });

    } finally {
      this._current = null;
      _cleanupFile(tmpFile);
    }
  }

  /**
   * Gibt Statistiken zurück.
   * @returns {object}
   */
  getStats() {
    return {
      totalAlarms:  this._totalAlarms,
      failedAlarms: this._failedAlarms,
      current:      this._current,
    };
  }

  /**
   * Gibt die Alarmhistorie zurück (neueste zuerst).
   * @param {number} [limit=50]
   * @returns {Array<object>}
   */
  getHistory(limit = 50) {
    const max = Math.min(limit, config.history.maxEntries);
    return _history.slice(-max).reverse();
  }
}

// ---------------------------------------------------------------------------
// Modul-private Helfer
// ---------------------------------------------------------------------------

/**
 * Ermittelt die Gong-Datei basierend auf dem Payload.
 * Gibt null zurück wenn kein Gong gewünscht oder Datei nicht gefunden.
 *
 * @param {string|undefined} gong
 * @param {string} alarmId
 * @returns {string|null}
 */
function _resolveGongFile(gong, alarmId) {
  if (!gong) return null;

  const gongPath = path.isAbsolute(gong)
    ? gong
    : path.join(config.audio.gongDir, gong.endsWith('.wav') ? gong : `${gong}.wav`);

  if (!fs.existsSync(gongPath)) {
    logger.warn('Gong-Datei nicht gefunden – Stream ohne Gong', { alarmId, gongPath });
    return null;
  }

  return gongPath;
}

/**
 * Ermittelt das RTP-Ziel (Host + Port) aus dem Payload oder der Konfiguration.
 *
 * @param {AlarmPayload} payload
 * @returns {{ host: string, port: number }}
 */
function _resolveRtpTarget(payload) {
  const host = (typeof payload.rtpHost === 'string' && payload.rtpHost.trim())
    ? payload.rtpHost.trim()
    : config.rtp.host;

  const port = (typeof payload.rtpPort === 'number' && payload.rtpPort > 0)
    ? payload.rtpPort
    : config.rtp.port;

  return { host, port };
}

/**
 * Fügt einen Eintrag zur Alarmhistorie hinzu (FIFO, max config.history.maxEntries).
 * @param {object} entry
 */
function _addToHistory(entry) {
  _history.push(entry);
  const maxEntries = config.history?.maxEntries ?? 200;
  if (_history.length > maxEntries) {
    _history.shift();
  }
  eventBus.emit('queue.changed', { historyLength: _history.length });
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
 * @property {string}  [id]        - Request-ID (wird erzeugt wenn fehlend)
 * @property {string}  text        - Zu sprechender Text (roh)
 * @property {string}  [voice]     - Piper-Stimme (override)
 * @property {number}  [speed]     - Sprechgeschwindigkeit (0.5–2.0)
 * @property {number}  [volume]    - Lautstärke 0–100
 * @property {string}  [gong]      - Gong-Dateiname (ohne Pfad, ohne .wav)
 * @property {string}  [rtpHost]   - RTP-Zieladresse (override)
 * @property {number}  [rtpPort]   - RTP-Zielport (override)
 * @property {string}  [codec]     - FFmpeg-Codec (override)
 * @property {string}  [bitrate]   - Bitrate (override)
 * @property {number}  [priority]  - Alarm-Priorität 1–10 (1 = höchste)
 */

module.exports = { AlarmService, getHistory: () => [..._history].reverse() };
