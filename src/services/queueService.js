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
 *
 * Events (via EventBus):
 *   alarm.received  { alarmId, text, priority, position, queueSize }
 *   queue.changed   { size, items }
 *   queue.empty     {}
 *   alarm.failed    { alarmId, error, code }  (nur bei Fehler im Worker)
 */

const { v4: uuidv4 } = require('uuid');
const config         = require('../config');
const logger         = require('../utils/logger').child({ service: 'QueueService' });
const eventBus       = require('../events/eventBus');
const { QueueFullError } = require('../errors');

/** @type {QueueService|null} */
let instance = null;

class QueueService {
  constructor() {
    /** @type {Array<QueueEntry>} */
    this._queue = [];

    /** @type {boolean} Worker läuft (darf laufen) */
    this._running = false;

    /** @type {boolean} Verarbeitung pausiert */
    this._paused = false;

    /**
     * Guard gegen doppelte _loop()-Instanzen.
     * Wird auf true gesetzt wenn _loop() aktiv läuft;
     * verhindert, dass resume() oder ein erneutes startWorker()
     * einen zweiten Loop startet während der erste noch im
     * await _sleep() oder await alarmService.process() steckt.
     * @type {boolean}
     */
    this._loopActive = false;

    /** @type {AlarmService|null} */
    this._alarmService = null;

    /** @type {number} Gesamt verarbeitete Alarme */
    this._processedTotal = 0;

    /** @type {number} Gesamt fehlgeschlagene Alarme */
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
   * @param {number} [priority]     - Priorität 1–10 (1 = höchste); Standard aus config
   * @returns {{ id: string, position: number }} Alarm-ID und Position in der Queue
   * @throws {QueueFullError} Wenn die Queue voll ist
   */
  enqueue(payload, priority = config.queue.defaultPriority) {
    if (this._queue.length >= config.queue.maxSize) {
      throw new QueueFullError(config.queue.maxSize);
    }

    const entry = {
      id:          payload.id || uuidv4(),
      payload:     { ...payload },
      priority:    Math.min(10, Math.max(1, priority)),
      enqueuedAt:  Date.now(),
    };

    // payload.id sicherstellen (für AlarmService)
    entry.payload.id = entry.id;

    // Sortiert einfügen: niedrigerer Priority-Wert → weiter vorne; gleiche Prio → FIFO
    const insertIdx = this._queue.findIndex((e) => e.priority > entry.priority);
    if (insertIdx === -1) {
      this._queue.push(entry);
    } else {
      this._queue.splice(insertIdx, 0, entry);
    }

    const position = this._queue.findIndex((e) => e.id === entry.id) + 1;

    logger.info('Alarm in Queue eingereiht', {
      alarmId:   entry.id,
      priority:  entry.priority,
      position,
      queueSize: this._queue.length,
    });

    eventBus.emit('alarm.received', {
      alarmId:   entry.id,
      text:      entry.payload.text || '',
      priority:  entry.priority,
      position,
      queueSize: this._queue.length,
    });

    eventBus.emit('queue.changed', {
      size:  this._queue.length,
      items: this._getPublicQueue(),
    });

    return { id: entry.id, position };
  }

  /**
   * Startet den Worker-Loop.
   * Sicher mehrfach aufrufbar – startet keinen zweiten Loop wenn bereits einer läuft.
   * @param {import('./alarmService').AlarmService} alarmService
   */
  startWorker(alarmService) {
    this._alarmService = alarmService;
    if (this._running) {
      logger.debug('startWorker: Worker läuft bereits, kein neuer Loop gestartet');
      return;
    }
    this._running = true;
    logger.info('Queue-Worker gestartet');
    this._startLoop();
  }

  /**
   * Stoppt den Worker-Loop sauber.
   * Der aktuell laufende Alarm wird noch abgeschlossen.
   * Nach stop() kann startWorker() erneut aufgerufen werden.
   */
  stop() {
    this._running    = false;
    this._loopActive = false;
    logger.info('Queue-Worker gestoppt', { remaining: this._queue.length });
  }

  /** Pausiert die Verarbeitung (laufende Alarmierung wird abgeschlossen). */
  pause() {
    this._paused = true;
    logger.info('Queue pausiert');
    eventBus.emit('queue.changed', {
      size:   this._queue.length,
      items:  this._getPublicQueue(),
      paused: true,
    });
  }

  /**
   * Setzt die Verarbeitung fort.
   * Startet _loop() nur wenn kein Loop bereits aktiv ist.
   */
  resume() {
    this._paused = false;
    logger.info('Queue fortgesetzt');
    eventBus.emit('queue.changed', {
      size:   this._queue.length,
      items:  this._getPublicQueue(),
      paused: false,
    });
    // Nur einen neuen Loop starten wenn:
    // (a) Worker generell laufen soll (_running)
    // (b) noch kein Loop aktiv ist (_loopActive)
    // Ohne diese Prüfung würde resume() einen zweiten Loop erzeugen
    // wenn der erste Loop noch im await steckt.
    if (this._running && !this._loopActive) {
      this._startLoop();
    }
  }

  /**
   * Gibt die aktuelle Warteschlange (bereinigt) zurück.
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
      size:            this._queue.length,
      maxSize:         config.queue.maxSize,
      processedTotal:  this._processedTotal,
      failedTotal:     this._failedTotal,
      running:         this._running,
      paused:          this._paused,
      items:           this._getPublicQueue(),
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Setzt _loopActive und startet den Loop.
   * Einzige erlaubte Einstiegspunkt für _loop().
   * @private
   */
  _startLoop() {
    if (this._loopActive) {
      logger.debug('_startLoop: Loop bereits aktiv, wird nicht erneut gestartet');
      return;
    }
    this._loopActive = true;
    this._loop().finally(() => {
      this._loopActive = false;
      logger.debug('Queue-Loop beendet');
    });
  }

  /**
   * Haupt-Loop: zieht Einträge aus der Queue und verarbeitet sie sequenziell.
   * Beendet sich selbst wenn _running = false oder _paused = true.
   * Darf nur über _startLoop() gestartet werden.
   * @private
   */
  async _loop() {
    while (this._running && !this._paused) {
      if (this._queue.length === 0) {
        await _sleep(200);
        continue;
      }

      const entry  = this._queue.shift();
      const waitMs = Date.now() - entry.enqueuedAt;

      eventBus.emit('queue.changed', {
        size:  this._queue.length,
        items: this._getPublicQueue(),
      });

      if (this._queue.length === 0) {
        eventBus.emit('queue.empty', {});
      }

      logger.info('Alarm wird verarbeitet', {
        alarmId:  entry.id,
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
          error:   err.message,
          code:    err.code,
          stack:   err.stack,
        });
        // alarm.failed wird bereits von AlarmService emittiert.
        // Hier KEIN zweites Emit – verhindert Dopplung im Dashboard.
      }
    }
  }

  /**
   * Gibt eine bereinigte Queue zurück (keine internen Felder).
   * @returns {Array<object>}
   */
  _getPublicQueue() {
    return this._queue.map((e) => ({
      id:          e.id,
      priority:    e.priority,
      text:        e.payload.text || e.payload.message || '',
      source:      e.payload.source || 'api',
      enqueuedAt:  new Date(e.enqueuedAt).toISOString(),
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

/** @param {number} ms */
const _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { QueueService };
