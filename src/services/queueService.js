'use strict';

/**
 * @file services/queueService.js
 * @description Priorisierte Alarm-Warteschlange.
 * Verarbeitet Alarmierungen seriell und stellt sicher, dass immer
 * nur eine Durchsage gleichzeitig läuft. Unterstützt Prioritäten 1–10.
 */

const { EventEmitter } = require('events');
const logger = require('../utils/logger').child({ service: 'QueueService' });
const eventBus = require('../events/eventBus');
const config = require('../config');
const { QueueFullError } = require('../errors');

/**
 * @typedef {object} QueueEntry
 * @property {string} id - Eindeutige Alarm-ID
 * @property {number} priority - Priorität 1 (niedrig) – 10 (kritisch)
 * @property {number} createdAt - Timestamp (ms) der Einreihung
 * @property {object} payload - Alarm-Nutzdaten
 */

class QueueService extends EventEmitter {
  /** @type {QueueService|null} */
  static #instance = null;

  /** @type {QueueEntry[]} */
  #queue = [];

  /** @type {boolean} */
  #running = false;

  /** @type {boolean} */
  #processing = false;

  /** @type {object|null} */
  #alarmService = null;

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  /**
   * Gibt die Singleton-Instanz zurück.
   * @returns {QueueService}
   */
  static getInstance() {
    if (!QueueService.#instance) {
      QueueService.#instance = new QueueService();
    }
    return QueueService.#instance;
  }

  /**
   * Fügt einen Alarm in die Warteschlange ein.
   * Höhere Priorität wird weiter vorne in der Queue einsortiert.
   *
   * @param {object} payload - Alarm-Nutzdaten
   * @param {string} payload.id - Eindeutige ID
   * @param {number} [payload.priority=5] - Priorität 1–10
   * @throws {QueueFullError} wenn die Queue die maximale Größe erreicht hat
   * @returns {QueueEntry}
   */
  enqueue(payload) {
    const maxSize = config.queue.maxSize;
    if (this.#queue.length >= maxSize) {
      logger.warn('Queue voll – Alarm abgelehnt', {
        alarmId: payload.id,
        queueSize: this.#queue.length,
        maxSize,
      });
      throw new QueueFullError(maxSize);
    }

    const entry = {
      id: payload.id,
      priority: Math.min(Math.max(payload.priority || config.queue.defaultPriority, 1), 10),
      createdAt: Date.now(),
      payload,
    };

    // Einsortieren nach Priorität (höher = weiter vorne), dann nach createdAt (FIFO)
    const insertIdx = this.#queue.findIndex(
      (e) => e.priority < entry.priority
    );
    if (insertIdx === -1) {
      this.#queue.push(entry);
    } else {
      this.#queue.splice(insertIdx, 0, entry);
    }

    logger.info('Alarm in Queue eingereiht', {
      alarmId: entry.id,
      priority: entry.priority,
      queueSize: this.#queue.length,
      position: insertIdx === -1 ? this.#queue.length : insertIdx + 1,
    });

    eventBus.emit('queue.changed', {
      size: this.#queue.length,
      entries: this._getPublicQueue(),
    });

    this._tryProcess();

    return entry;
  }

  /**
   * Entfernt einen Alarm aus der Queue (nur wenn noch nicht in Verarbeitung).
   * @param {string} id
   * @returns {boolean}
   */
  remove(id) {
    const idx = this.#queue.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.#queue.splice(idx, 1);
    logger.info('Alarm aus Queue entfernt', { alarmId: id });
    eventBus.emit('queue.changed', {
      size: this.#queue.length,
      entries: this._getPublicQueue(),
    });
    return true;
  }

  /**
   * Startet den Queue-Worker.
   * @param {object} alarmService - AlarmService-Instanz
   */
  startWorker(alarmService) {
    this.#alarmService = alarmService;
    this.#running = true;
    logger.info('Queue-Worker gestartet.');
  }

  /**
   * Stoppt den Worker sauber.
   */
  async stop() {
    this.#running = false;
    logger.info('Queue-Worker wird gestoppt...', { pending: this.#queue.length });
    // Warten bis laufende Verarbeitung endet (max. 30 Sek.)
    const deadline = Date.now() + 30_000;
    while (this.#processing && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    this.#queue = [];
    logger.info('Queue-Worker gestoppt.');
  }

  /**
   * Gibt die aktuelle Queue-Größe zurück.
   * @returns {number}
   */
  get size() {
    return this.#queue.length;
  }

  /**
   * Gibt die aktuelle Queue als öffentliche (bereinigt) Liste zurück.
   * @returns {Array}
   */
  _getPublicQueue() {
    return this.#queue.map((e) => ({
      id: e.id,
      priority: e.priority,
      createdAt: e.createdAt,
      text: e.payload.text,
      source: e.payload.source || 'api',
    }));
  }

  /**
   * Interne Methode: Startet die Verarbeitung wenn nicht bereits aktiv.
   */
  async _tryProcess() {
    if (this.#processing || !this.#running || this.#queue.length === 0) return;
    if (!this.#alarmService) {
      logger.warn('Kein AlarmService gesetzt – Queue wird nicht verarbeitet.');
      return;
    }

    this.#processing = true;

    while (this.#running && this.#queue.length > 0) {
      const entry = this.#queue.shift();

      eventBus.emit('queue.changed', {
        size: this.#queue.length,
        entries: this._getPublicQueue(),
        processing: entry.id,
      });

      try {
        await this.#alarmService.process(entry.payload);
      } catch (err) {
        logger.error('Fehler bei der Alarmverarbeitung', {
          alarmId: entry.id,
          error: err.message,
          stack: err.stack,
        });
        eventBus.emit('alarm.failed', {
          alarmId: entry.id,
          error: err.message,
        });
      }

      if (this.#queue.length === 0) {
        eventBus.emit('queue.empty', {});
      }
    }

    this.#processing = false;
  }
}

module.exports = { QueueService };
