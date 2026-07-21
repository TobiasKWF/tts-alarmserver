'use strict';

/**
 * Sprachoptimierung – Pipeline für natürliche TTS-Ausgabe.
 *
 * NEUE Architektur (Hash-Format):
 *   Das Stichwort (Feld [0], z.B. "B 3Y") wird NICHT durch alarmMapping
 *   gejagt. TTS spricht Buchstaben und Ziffern direkt aus:
 *     "B 3Y"   → "B drei Y"
 *     "H VU-1" → "H V U 1" (buchstäblich)
 *
 *   Beschreibung (Feld [1]), Adresse (Feld [2]) und Bemerkung (Feld [5+])
 *   durchlaufen die normale Pipeline:
 *     Abkürzungen auflösen + Straßencodes + Zahlen
 *
 * Pipeline-Übersicht:
 *   enhanceStichwort(text)  – nur Unicode + Zahlen (keine Codes)
 *   enhanceSpeech(text)     – vollständige Pipeline (Abk., Straßen, Zahlen)
 *   buildAlarmSpeech(info)  – setzt die Felder aus extractAlarmInfo() zusammen
 */

const { cleanUnicode }                           = require('../utils/unicode');
const { replaceNumbers }                          = require('../utils/numbers');
const { replaceRoadCodes, replaceAbbreviations }  = require('./mappings/roadMapping');

/**
 * Minimale Pipeline für das Stichwort:
 *   - Unicode bereinigen
 *   - Zahlen als Zahlwörter sprechen ("3" → "drei")
 *   - KEIN alarmMapping, KEIN Straßencode-Ersetzen
 */
function enhanceStichwort(text) {
  let r = cleanUnicode(text);
  r = replaceNumbers(r);
  return r.replace(/\s+/g, ' ').trim();
}

/**
 * Vollständige Pipeline für Beschreibung, Adresse und Bemerkung.
 */
function enhanceSpeech(text) {
  let r = cleanUnicode(text);
  r = replaceRoadCodes(r);
  r = replaceAbbreviations(r);
  r = replaceNumbers(r);
  return r.replace(/\s+/g, ' ').trim();
}

/**
 * Baut aus den vier Feldern von extractAlarmInfo() einen vollständigen
 * Sprachtext zusammen.
 *
 * @param {{ stichwort: string, beschreibung: string, location: string, locationAdditional: string }} info
 * @returns {string}
 */
function buildAlarmSpeech(info) {
  const { stichwort, beschreibung, location, locationAdditional } = info;

  const parts = [];

  // Stichwort: roh vorlesen (nur Zahlen umwandeln)
  if (stichwort) {
    parts.push(enhanceStichwort(stichwort) + '.');
  }

  // Beschreibung: Abkürzungen + Zahlen
  if (beschreibung) {
    parts.push(enhanceSpeech(beschreibung) + '.');
  }

  // Adresse
  if (location) {
    const { deduplicateRoadRefs } = require('./alarmCleaner');
    parts.push('Einsatzort: ' + enhanceSpeech(deduplicateRoadRefs(location)) + '.');
  }

  // Objekt + Bemerkung
  if (locationAdditional) {
    parts.push('Einsatzobjekt: ' + enhanceSpeech(locationAdditional) + '.');
  }

  return parts.join(' ').trim();
}

module.exports = { enhanceSpeech, enhanceStichwort, buildAlarmSpeech };
