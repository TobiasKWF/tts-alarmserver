'use strict';

/**
 * Queue-Service – serialisiert Alarmierungen.
 *
 * Mehrere gleichzeitige POST-Anfragen werden nacheinander verarbeitet
 * (Concurrency = 1), um Audio-Konflikte am RTP-Ausgang zu vermeiden.
 * Überschreitet die Queue maxSize, wird eine 429-Antwort gesendet.
 */

const config = require('../config');
const logger = require('../logging/logger');

class AlarmQueue {
  constructor() {
    this.queue = [];
    this.running = 0;
    this.maxConcurrency = config.queue.concurrency;
    this.maxSize = config.queue.maxSize;
  }

  /**
   * Fügt eine Aufgabe der Queue hinzu.
   * @param {Function} task  - Async-Funktion
   * @returns {Promise<any>}
   */
  enqueue(task) {
    if (this.queue.length >= this.maxSize) {
      return Promise.reject(Object.assign(
        new Error('Queue voll – zu viele gleichzeitige Anfragen'),
        { statusCode: 429 },
      ));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._run();
    });
  }

  _run() {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift();
      this.running++;

      Promise.resolve()
        .then(() => task())
        .then(
          (result) => { this.running--; resolve(result); this._run(); },
          (err)    => { this.running--; reject(err);    this._run(); },
        );
    }
  }

  /** Aktueller Status der Queue. */
  status() {
    return {
      running: this.running,
      waiting: this.queue.length,
      maxConcurrency: this.maxConcurrency,
      maxSize: this.maxSize,
    };
  }
}

// Singleton
const queue = new AlarmQueue();
module.exports = queue;
