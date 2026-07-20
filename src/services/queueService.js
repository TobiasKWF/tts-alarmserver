'use strict';

/**
 * Queue-Service – serialisiert Alarmierungen.
 *
 * Mehrere gleichzeitige POST-Anfragen werden nacheinander verarbeitet
 * (Concurrency = 1), um Audio-Konflikte am RTP-Ausgang zu vermeiden.
 * Ueberschreitet die Queue maxSize, wird eine 429-Antwort gesendet.
 *
 * v3.1: Meldet Queue-Aenderungen an DashboardState.
 */

const config         = require('../config');
const logger         = require('../logging/logger');
const DashboardState = require('./dashboardState');

class AlarmQueue {
  constructor() {
    this.queue          = [];
    this.running        = 0;
    this.maxConcurrency = config.queue.concurrency;
    this.maxSize        = config.queue.maxSize;
  }

  /**
   * Fuegt eine Aufgabe der Queue hinzu.
   * @param {Function} task       - Async-Funktion
   * @param {object}   [meta={}]  - Optionale Metadaten fuer das Dashboard { id, priority, source, text }
   * @returns {Promise<any>}
   */
  enqueue(task, meta = {}) {
    if (this.queue.length >= this.maxSize) {
      return Promise.reject(Object.assign(
        new Error('Queue voll – zu viele gleichzeitige Anfragen'),
        { statusCode: 429 },
      ));
    }

    return new Promise((resolve, reject) => {
      const entry = {
        task,
        resolve,
        reject,
        meta: {
          id:       meta.id       || null,
          priority: meta.priority || 5,
          source:   meta.source   || 'api',
          text:     meta.text     || '',
          queuedAt: Date.now(),
        },
      };
      this.queue.push(entry);
      this._notifyDashboard();
      this._run();
    });
  }

  _run() {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const { task, resolve, reject, meta } = this.queue.shift();
      this.running++;
      this._notifyDashboard();

      Promise.resolve()
        .then(() => task())
        .then(
          (result) => { this.running--; resolve(result); this._run(); this._notifyDashboard(); },
          (err)    => { this.running--; reject(err);    this._run(); this._notifyDashboard(); },
        );
    }
  }

  /** Pusht aktuelle Queue-Inhalte an DashboardState. */
  _notifyDashboard() {
    try {
      const state = DashboardState.getInstance();
      state.updateQueue(this.queue.map(e => e.meta));
    } catch (_) { /* DashboardState nicht kritisch */ }
  }

  /** Aktueller Status der Queue. */
  status() {
    return {
      running:        this.running,
      waiting:        this.queue.length,
      maxConcurrency: this.maxConcurrency,
      maxSize:        this.maxSize,
    };
  }
}

// Singleton
const queue = new AlarmQueue();
module.exports = queue;
