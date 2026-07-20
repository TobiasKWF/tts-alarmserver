'use strict';

/**
 * Unicode- und UTF-8-Bereinigung.
 *
 * Führt alle Normalisierungsschritte durch, bevor Text an Piper übergeben wird:
 * - NFC-Normalisierung
 * - Fehlerhafte Windows-1252-Ersetzungen reparieren
 * - Zero-Width und unsichtbare Zeichen entfernen
 * - Combining Diacritical Marks entfernen (außer Standard-Umlaute)
 * - Steuerzeichen entfernen
 * - Doppelte Leerzeichen konsolidieren
 */

/**
 * Bekannte Windows-1252-Fehlkodierungen → korrektes Unicode
 */
const WIN1252_MAP = [
  [/\u201E/g,  'ä'],  // „ fälschlich für ä
  [/\u201C/g,  'ü'],  // " fälschlich für ü
  [/\u00E4/g,  'ä'],
  [/\u00F6/g,  'ö'],
  [/\u00FC/g,  'ü'],
  [/\u00C4/g,  'Ä'],
  [/\u00D6/g,  'Ö'],
  [/\u00DC/g,  'Ü'],
  [/\u00DF/g,  'ß'],
  // typische Muster aus falsch dekodiertem Latin-1
  [/verd[\u201E"]chtiger?/gi, 'verdächtiger'],
  [/Stra[\u201E"]e/gi,        'Straße'],
  [/Geb[\u201E"]ude/gi,       'Gebäude'],
];

/**
 * Entfernt unsichtbare und nicht druckbare Unicode-Zeichen:
 * Zero-Width Space, Zero-Width Non-Joiner, Zero-Width Joiner, Soft Hyphen, BOM etc.
 */
const INVISIBLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180D\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFA0]/g;

/**
 * Bereinigt einen Text vollständig für die TTS-Ausgabe.
 * @param {string} text
 * @returns {string}
 */
function cleanUnicode(text) {
  if (!text) return '';

  // 1. NFC normalisieren
  let result = text.normalize('NFC');

  // 2. Windows-1252-Fehlkodierungen reparieren
  for (const [pattern, replacement] of WIN1252_MAP) {
    result = result.replace(pattern, replacement);
  }

  // 3. Unsichtbare Zeichen entfernen
  result = result.replace(INVISIBLE_RE, '');

  // 4. Combining Diacritical Marks (U+0300–U+036F) entfernen
  //    NFC hat echte Umlaute bereits zusammengesetzt, diese Marks sind Artefakte.
  result = result.replace(/[\u0300-\u036F]/g, '');

  // 5. Steuerzeichen entfernen (außer \n, \r, \t)
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 6. Nicht druckbare Latin-1-Supplement-Zeichen bereinigen
  result = result.replace(/[\x80-\x9F]/g, '');

  // 7. Doppelte Leerzeichen konsolidieren
  result = result.replace(/[ \t]+/g, ' ');

  return result.trim();
}

module.exports = { cleanUnicode };
