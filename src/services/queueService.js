'use strict';

/**
 * @file services/queueService.js
 * @description Prioritäts-Warteschlange für Alarmierungen.
 * Verwaltet eingehende Alarme, verarbeitet sie sequenziell
 * und emittiert queue.changed / queue.empty Events.
 */

const logger = require('../utils/logger').child({ service: 'QueueService' });
const eventBus = require('../events/eventBus');
const config = require('../config');

/** @typedef {{ id: string, priority: number, payload: object, receivedAt: string }} QueueItem */

class QueueService {
  /** @type {QueueService|null} */
  static #instance = null;

  constructor() {
    /** @type {QueueItem[]} */
    this._queue = [];
    this._processing = false;
    this._stopped = false;
    /** @type {AlarmService|null} */
    this._alarmService = null;
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
   * Setzt den AlarmService (Dependency Injection).
   * @param {object} alarmService
   */
  setAlarmService(alarmService) {
    this._alarmService = alarmService;
  }

  /**
   * Startet den Queue-Worker mit dem AlarmService.
   * @param {object} alarmService
   */
  startWorker(alarmService) {
    this._alarmService = alarmService;
    logger.info('Queue-Worker gestartet.');
  }

  /**
   * Fügt eine Alarmierung in die Warteschlange ein.
   * Sortiert nach Priorität (niedrigerer Wert = höhere Priorität).
   * @param {string} id - Eindeutige Alarm-ID (UUID)
   * @param {object} payload - Alarm-Nutzlast
   * @param {number} [priority] - Priorität (1=höchste, 10=niedrigste)
   * @returns {QueueItem}
   * @throws {QueueFullError}
   */
  enqueue(id, payload, priority) {
    const { QueueFullError } = require('../errors');
    const maxSize = config.queue.maxSize;

    if (this._queue.length >= maxSize) {
      logger.warn('Queue voll – Alarm abgelehnt', { id, queueSize: this._queue.length });
      throw new QueueFullError(maxSize);
    }

    const effectivePriority = (typeof priority === 'number' && priority >= 1 && priority <= 10)
      ? priority
      : config.queue.defaultPriority;

    /** @type {QueueItem} */
    const item = {
      id,
      priority: effectivePriority,
      payload,
      receivedAt: new Date().toISOString(),
    };

    this._queue.push(item);
    // Stabile Sortierung nach Priorität (aufsteigend = höhere Wichtigkeit zuerst)
    this._queue.sort((a, b) => a.priority - b.priority);

    logger.info('Alarm in Queue eingereiht', {
      id,
      priority: effectivePriority,
      queueSize: this._queue.length,
    });

    eventBus.emit('queue.changed', {
      queueSize: this._queue.length,
      items: this._getPublicQueueSnapshot(),
    });

    // Worker anstoßen (falls nicht bereits aktiv)
    setImmediate(() => this._processNext());

    return item;
  }

  /**
   * Gibt eine öffentliche Übersicht der Queue zurück (ohne interne Details).
   * @returns {Array<{id: string, priority: number, receivedAt: string}>}
   */
  _getPublicQueueSnapshot() {
    return this._queue.map(({ id, priority, receivedAt }) => ({ id, priority, receivedAt }));
  }

  /**
   * Verarbeitet den nächsten Alarm in der Queue.
   * Wird nach jedem Enqueue und nach jeder abgeschlossenen Verarbeitung aufgerufen.
   */
  async _processNext() {
    if (this._processing || this._stopped || this._queue.length === 0) {
      if (this._queue.length === 0 && !this._processing) {
        eventBus.emit('queue.empty', {});
      }
      return;
    }

    this._processing = true;
    const item = this._queue.shift();

    logger.info('Alarm-Verarbeitung gestartet', { id: item.id, priority: item.priority });

    eventBus.emit('queue.changed', {
      queueSize: this._queue.length,
      items: this._getPublicQueueSnapshot(),
      current: { id: item.id, priority: item.priority },
    });

    try {
      if (!this._alarmService) {
        throw new Error('AlarmService nicht gesetzt');
      }
      await this._alarmService.process(item);
      logger.info('Alarm-Verarbeitung abgeschlossen', { id: item.id });
    } catch (err) {
      logger.error('Fehler bei der Alarm-Verarbeitung', {
        id: item.id,
        error: err.message,
        stack: err.stack,
      });
      eventBus.emit('alarm.failed', {
        id: item.id,
        error: err.message,
      });
    } finally {
      this._processing = false;
      // Nächsten Eintrag verarbeiten
      setImmediate(() => this._processNext());
    }
  }

  /**
   * Gibt die aktuelle Queue-Größe zurück.
   * @returns {number}
   */
  get size() {
    return this._queue.length;
  }

  /**
   * Gibt true zurück wenn die Queue gerade verarbeitet wird.
   * @returns {boolean}
   */
  get isProcessing() {
    return this._processing;
  }

  /**
   * Gibt eine Kopie der aktuellen Queue zurück.
   * @returns {QueueItem[]}
   */
  getQueue() {
    return [...this._queue];
  }

  /**
   * Stoppt den Worker und leert die Queue.
   */
  async stop() {
    this._stopped = true;
    this._queue = [];
    logger.info('QueueService gestoppt.');
  }

  /**
   * Setzt die Singleton-Instanz zurück (nur für Tests).
   */
  static _reset() {
    QueueService.#instance = null;
  }
}

module.exports = { QueueService };
