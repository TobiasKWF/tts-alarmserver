'use strict';

/**
 * @file events/eventBus.js
 * @description Globaler EventEmitter als zentraler Event-Bus.
 * Alle Services kommunizieren über definierte Events, ohne sich
 * gegenseitig zu kennen (lose Kopplung).
 *
 * Definierte Events:
 *
 * alarm.received    – Neue Alarmierung eingegangen
 * alarm.started     – Alarmierung startet (beginnt Wiedergabe)
 * alarm.finished    – Alarmierung abgeschlossen
 * alarm.failed      – Alarmierung fehlgeschlagen
 *
 * tts.started       – Piper TTS gestartet
 * tts.finished      – Piper TTS beendet
 * tts.failed        – Piper TTS fehlgeschlagen
 *
 * stream.started    – RTP-Stream gestartet
 * stream.finished   – RTP-Stream beendet
 * stream.failed     – RTP-Stream fehlgeschlagen
 *
 * queue.changed     – Warteschlange hat sich verändert
 * queue.empty       – Warteschlange ist leer

 * server.started    – Server erfolgreich gestartet
 * server.stopping   – Server wird heruntergefahren
 */

const { EventEmitter } = require('events');

class AlarmEventBus extends EventEmitter {
  constructor() {
    super();
    // Erhöhe das Limit um viele Listener zu unterstützen
    this.setMaxListeners(50);
  }

  /**
   * Emittiert ein typsicheres Event und loggt es im Debug-Modus.
   * @param {string} event - Event-Name
   * @param {object} [data={}] - Event-Payload
   * @returns {boolean}
   */
  emit(event, data = {}) {
    return super.emit(event, {
      event,
      timestamp: new Date().toISOString(),
      ...data,
    });
  }
}

// Singleton-Instanz
const eventBus = new AlarmEventBus();

module.exports = eventBus;
