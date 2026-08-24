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

const POSTAL_CODE_DIGITS = {
  '0': 'null', '1': 'eins', '2': 'zwei', '3': 'drei', '4': 'vier',
  '5': 'fünf', '6': 'sechs', '7': 'sieben', '8': 'acht', '9': 'neun',
};

/**
 * Deutsche Postleitzahlen werden bei Alarmierungen immer ziffernweise
 * gesprochen, z.B. 38300 → "drei acht drei null null".
 * Die Ersetzung erfolgt ausschließlich im Einsatzort, damit normale
 * fünfstellige Zahlen in anderen Textfeldern nicht verändert werden.
 */
function replacePostalCodes(text) {
  return text.replace(/(?<!\d)\d{5}(?!\d)/g, (postalCode) =>
    postalCode.split('').map(d => POSTAL_CODE_DIGITS[d]).join(' ')
  );
}

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
 * Vollständige Pipeline für den Einsatzort inklusive PLZ-Ziffernfolge.
 */
function enhanceLocation(text) {
  let r = cleanUnicode(text);
  r = replaceRoadCodes(r);
  r = replaceAbbreviations(r);
  r = replacePostalCodes(r);
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

  // Adresse: Abkürzungen + Straßen + PLZ ziffernweise
  if (location) {
    const { deduplicateRoadRefs } = require('./alarmCleaner');
    parts.push('Einsatzort: ' + enhanceLocation(deduplicateRoadRefs(location)) + '.');
  }

  // Objekt + Bemerkung
  if (locationAdditional) {
    parts.push('Einsatzobjekt: ' + enhanceSpeech(locationAdditional) + '.');
  }

  return parts.join(' ').trim();
}

module.exports = { enhanceSpeech, enhanceStichwort, buildAlarmSpeech, enhanceLocation, replacePostalCodes };
