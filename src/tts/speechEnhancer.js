'use strict';

/**
 * Sprachoptimierung – Pipeline für natürliche TTS-Ausgabe.
 *
 * Reihenfolge der Transformationen:
 *   1. Unicode-Bereinigung
 *   2. Alarm-Codes ersetzen  (B2 → Brand zwei)
 *   3. Straßen-Codes ersetzen (A2 → Autobahn zwei)
 *   4. Abkürzungen ersetzen   (Str. → Straße)
 *   5. Zahlen ersetzen        (12 → zwölf)
 */

const { cleanUnicode }       = require('../utils/unicode');
const { replaceNumbers }      = require('../utils/numbers');
const { replaceAlarmCodes }   = require('./mappings/alarmMapping');
const { replaceRoadCodes, replaceAbbreviations } = require('./mappings/roadMapping');

/**
 * Vollständige Sprach-Optimierungspipeline.
 * @param {string} text - Bereits bereinigter Alarmtext
 * @returns {string}   - Für Piper optimierter Text
 */
function enhanceSpeech(text) {
  let result = text;

  // 1. Unicode bereinigen
  result = cleanUnicode(result);

  // 2. Alarm-Codes
  result = replaceAlarmCodes(result);

  // 3. Straßen-Codes
  result = replaceRoadCodes(result);

  // 4. Abkürzungen
  result = replaceAbbreviations(result);

  // 5. Zahlen
  result = replaceNumbers(result);

  // 6. Mehrfach-Leerzeichen nochmal konsolidieren
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

module.exports = { enhanceSpeech };
