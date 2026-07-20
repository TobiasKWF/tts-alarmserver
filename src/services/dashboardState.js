'use strict';

/**
 * @file dashboardState.js
 * @description Zentraler In-Memory-State für das Dashboard (v3.1).
 * Singleton mit EventEmitter – wird von AlarmService, QueueService
 * und Fehlerbehandlung befüllt und vom WebSocket-Handler abonniert.
 */

const EventEmitter = require('events');
const dashboardConfig = require('../config/dashboard');

class DashboardState extends EventEmitter {
  constructor() {
    super();
    this.startTime     = Date.now();
    this.currentSpeech = null;  // { text, alarmId, voice, startedAt, durationMs }
    this.queue         = [];    // Array<{ id, priority, source, text, queuedAt }>
    this.history       = [];    // letzte N Alarme
    this.errors        = [];    // letzte N Fehler
    this.wsClients     = 0;
  }

  // --- Speech ---

  setCurrentSpeech(data) {
    this.currentSpeech = { ...data, startedAt: data.startedAt || Date.now() };
    this.emit('update', { type: 'speech', payload: this.currentSpeech });
  }

  clearCurrentSpeech() {
    this.currentSpeech = null;
    this.emit('update', { type: 'speech', payload: null });
  }

  // --- Queue ---

  updateQueue(queue) {
    this.queue = Array.isArray(queue) ? [...queue] : [];
    this.emit('update', { type: 'queue', payload: this.queue });
  }

  // --- History ---

  addToHistory(entry) {
    this.history.unshift({ ...entry, finishedAt: entry.finishedAt || Date.now() });
    if (this.history.length > dashboardConfig.historyLimit) {
      this.history = this.history.slice(0, dashboardConfig.historyLimit);
    }
    this.emit('update', { type: 'history', payload: this.history });
  }

  // --- Errors ---

  addError(err) {
    const entry = {
      message: err.message || String(err),
      stack:   err.stack   || null,
      ts:      Date.now(),
    };
    this.errors.unshift(entry);
    if (this.errors.length > dashboardConfig.errorLimit) {
      this.errors = this.errors.slice(0, dashboardConfig.errorLimit);
    }
    this.emit('update', { type: 'error', payload: this.errors });
  }

  // --- Snapshot (für neue WS-Verbindungen) ---

  getSnapshot() {
    return {
      type:          'snapshot',
      uptime:        Math.floor((Date.now() - this.startTime) / 1000),
      wsClients:     this.wsClients,
      currentSpeech: this.currentSpeech,
      queue:         this.queue,
      history:       this.history,
      errors:        this.errors,
    };
  }

  // --- Singleton ---

  static getInstance() {
    if (!DashboardState._instance) {
      DashboardState._instance = new DashboardState();
    }
    return DashboardState._instance;
  }
}

DashboardState._instance = null;

module.exports = DashboardState;
