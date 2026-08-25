'use strict';

/**
 * Sprachoptimierung – Pipeline für natürliche TTS-Ausgabe.
 *
 * NEUE Architektur (Hash-Format):
 *   Das Stichwort wird kontextabhängig aufgelöst. Insbesondere werden
 *   Brand- und Verkehrsunfall-Stichworte nicht mit Straßenkürzeln verwechselt.
 *
 * Beispiele:
 *   "B 2"    → "Brand zwei"
 *   "B2"     → "Brand zwei"
 *   "H VU-1" → "Hilfeleistung Verkehrsunfall leicht"
 *
 * Beschreibung (Feld [1]), Adresse (Feld [2]) und Bemerkung (Feld [5+])
 * durchlaufen die normale Pipeline:
 *   Abkürzungen auflösen + Straßencodes + Zahlen
 */

const { cleanUnicode } = require('../utils/unicode');
const { replaceNumbers } = require('../utils/numbers');
const { replaceRoadCodes, replaceAbbreviations } = require('./mappings/roadMapping');

const POSTAL_CODE_DIGITS = {
  '0': 'null', '1': 'eins', '2': 'zwei', '3': 'drei', '4': 'vier',
  '5': 'fünf', '6': 'sechs', '7': 'sieben', '8': 'acht', '9': 'neun',
};

/**
 * Deutsche Postleitzahlen werden bei Alarmierungen immer ziffernweise
 * gesprochen, z.B. 38300 → "drei acht drei null null".
 */
function replacePostalCodes(text) {
  return text.replace(/(?<!\d)\d{5}(?!\d)/g, (postalCode) =>
    postalCode.split('').map(d => POSTAL_CODE_DIGITS[d]).join(' ')
  );
}

/**
 * Stichwort-Mapping.
 *
 * Wichtig: Das generische B2 darf hier NICHT als Bundesstraße interpretiert
 * werden. Im Stichwort-Kontext bedeutet B = Brand.
 *
 * H VU-1 wird als Hilfeleistung Verkehrsunfall leicht gesprochen.
 */
function enhanceStichwort(text) {
  let r = cleanUnicode(text).trim();

  // Hilfeleistung + Verkehrsunfall-Schweregrad
  // Unterstützt H VU-1, HVU-1, H VU 1 und H VU1.
  const hVuMatch = r.match(/^H\s*V\s*U\s*[- ]?([0-9]+)$/i);
  if (hVuMatch) {
    const level = parseInt(hVuMatch[1], 10);
    const levels = {
      1: 'leicht',
      2: 'mittel',
      3: 'schwer',
    };
    return 'Hilfeleistung Verkehrsunfall ' + (levels[level] || replaceNumbers(String(level)));
  }

  // Brandstichwort: B 1 / B1 / B 2 / B2 ...
  const brandMatch = r.match(/^B\s*([0-9]+)$/i);
  if (brandMatch) {
    return 'Brand ' + replaceNumbers(brandMatch[1]);
  }

  // Reines Verkehrsunfall-Stichwort
  if (/^V\s*U$/i.test(r)) {
    return 'Verkehrsunfall';
  }

  // Reines VU mit Schweregrad, z.B. VU-1
  const vuMatch = r.match(/^V\s*U\s*[- ]?([0-9]+)$/i);
  if (vuMatch) {
    const level = parseInt(vuMatch[1], 10);
    const levels = { 1: 'leicht', 2: 'mittel', 3: 'schwer' };
    return 'Verkehrsunfall ' + (levels[level] || replaceNumbers(String(level)));
  }

  // Andere Stichworte wie bisher: Zahlen in Zahlwörter umwandeln.
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

  if (stichwort) {
    parts.push(enhanceStichwort(stichwort) + '.');
  }

  if (beschreibung) {
    parts.push(enhanceSpeech(beschreibung) + '.');
  }

  if (location) {
    const { deduplicateRoadRefs } = require('./alarmCleaner');
    parts.push('Einsatzort: ' + enhanceLocation(deduplicateRoadRefs(location)) + '.');
  }

  if (locationAdditional) {
    parts.push('Einsatzobjekt: ' + enhanceSpeech(locationAdditional) + '.');
  }

  return parts.join(' ').trim();
}

module.exports = { enhanceSpeech, enhanceStichwort, buildAlarmSpeech, enhanceLocation, replacePostalCodes };
