'use strict';

/**
 * @file services/queueService.js
 * @description Prioritäts-Queue für Alarmierungen.
 *
 * Eingehende Alarmierungen werden nicht sofort verarbeitet, sondern in
 * eine Warteschlange eingereiht. Ein Worker-Loop zieht jeweils einen
 * Eintrag heraus und delegiert die Verarbeitung an den AlarmService.
 *
 * Prioritäten: 1 (höchste) bis 10 (niedrigste). Gleiche Priorität → FIFO.
 */

const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger').child({ service: 'QueueService' });
const eventBus = require('../events/eventBus');

/** @type {QueueService|null} */
let instance = null;

class QueueService {
  constructor() {
    /** @type {Array<QueueEntry>} */
    this._queue = [];

    /** @type {boolean} */
    this._running = false;

    /** @type {boolean} */
    this._paused = false;

    /** @type {AlarmService|null} */
    this._alarmService = null;

    /** @type {number} */
    this._processedTotal = 0;

    /** @type {number} */
    this._failedTotal = 0;
  }

  /**
   * Gibt die Singleton-Instanz zurück.
   * @returns {QueueService}
   */
  static getInstance() {
    if (!instance) instance = new QueueService();
    return instance;
  }

  /**
   * Fügt eine Alarmierung in die Queue ein.
   *
   * @param {object} payload        - Alarm-Daten (text, voice, rtp, …)
   * @param {number} [priority=5]   - Priorität 1–10 (1 = höchste)
   * @returns {{ id: string, position: number }} Alarm-ID und Position in der Queue
   * @throws {Error} Wenn die Queue voll ist
   */
  enqueue(payload, priority = config.queue.defaultPriority) {
    if (this._queue.length >= config.queue.maxSize) {
      throw Object.assign(new Error('Queue ist voll'), { code: 'QUEUE_FULL', statusCode: 429 });
    }

    const entry = {
      id: payload.id || uuidv4(),
      payload,
      priority: Math.min(10, Math.max(1, priority)),
      enqueuedAt: Date.now(),
    };

    // Sortiert einfügen: niedrigerer Priority-Wert → weiter vorne
    const insertIdx = this._queue.findIndex((e) => e.priority > entry.priority);
    if (insertIdx === -1) {
      this._queue.push(entry);
    } else {
      this._queue.splice(insertIdx, 0, entry);
    }

    const position = this._queue.findIndex((e) => e.id === entry.id) + 1;

    logger.info('Alarm in Queue eingereiht', {
      alarmId: entry.id,
      priority: entry.priority,
      position,
      queueSize: this._queue.length,
    });

    eventBus.emit('queue.changed', {
      size: this._queue.length,
      items: this._getPublicQueue(),
    });

    return { id: entry.id, position };
  }

  /**
   * Startet den Worker-Loop.
   * @param {AlarmService} alarmService
   */
  startWorker(alarmService) {
    this._alarmService = alarmService;
    if (this._running) return;
    this._running = true;
    logger.info('Queue-Worker gestartet');
    this._loop();
  }

  /**
   * Stoppt den Worker-Loop sauber.
   */
  async stop() {
    this._running = false;
    logger.info('Queue-Worker wird gestoppt', { remaining: this._queue.length });
  }

  /** Pausiert die Verarbeitung (laufende Alarmierung wird abgeschlossen). */
  pause() {
    this._paused = true;
    logger.info('Queue pausiert');
  }

  /** Setzt die Verarbeitung fort. */
  resume() {
    this._paused = false;
    logger.info('Queue fortgesetzt');
    this._loop();
  }

  /**
   * Gibt aktuelle Warteschlange (öffentlich, ohne interne Felder) zurück.
   * @returns {Array<object>}
   */
  getQueue() {
    return this._getPublicQueue();
  }

  /**
   * Gibt Statistiken über die Queue zurück.
   * @returns {object}
   */
  getStats() {
    return {
      size: this._queue.length,
      processedTotal: this._processedTotal,
      failedTotal: this._failedTotal,
      running: this._running,
      paused: this._paused,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Haupt-Loop: zieht Einträge aus der Queue und verarbeitet sie sequenziell.
   */
  async _loop() {
    while (this._running) {
      if (this._paused || this._queue.length === 0) {
        await _sleep(200);
        continue;
      }

      const entry = this._queue.shift();

      eventBus.emit('queue.changed', {
        size: this._queue.length,
        items: this._getPublicQueue(),
      });

      if (this._queue.length === 0) {
        eventBus.emit('queue.empty', {});
      }

      const waitMs = Date.now() - entry.enqueuedAt;
      logger.info('Alarm wird verarbeitet', {
        alarmId: entry.id,
        priority: entry.priority,
        waitMs,
      });

      try {
        await this._alarmService.process(entry.payload);
        this._processedTotal++;
      } catch (err) {
        this._failedTotal++;
        logger.error('Fehler bei der Alarm-Verarbeitung', {
          alarmId: entry.id,
          error: err.message,
          stack: err.stack,
        });
        eventBus.emit('alarm.failed', {
          alarmId: entry.id,
          error: err.message,
        });
      }
    }
  }

  /**
   * Gibt eine bereinigte Queue zurück (kein internes State).
   * @returns {Array<object>}
   */
  _getPublicQueue() {
    return this._queue.map((e) => ({
      id: e.id,
      priority: e.priority,
      text: e.payload.text || e.payload.message || '',
      enqueuedAt: new Date(e.enqueuedAt).toISOString(),
    }));
  }
}

/**
 * @typedef {object} QueueEntry
 * @property {string} id
 * @property {object} payload
 * @property {number} priority
 * @property {number} enqueuedAt
 */

/**
 * Hilfsfunktion: nicht-blockierendes Sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { QueueService };
