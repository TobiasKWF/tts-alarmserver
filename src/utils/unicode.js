'use strict';

/**
 * Unicode- und UTF-8-Bereinigung.
 *
 * Führt alle Normalisierungsschritte durch, bevor Text an Piper übergeben wird:
 * - NFC-Normalisierung
 * - Fehlerhafte Windows-1252-Ersetzungen reparieren
 * - Bekannte Leitstellen-Fehlkodierungen reparieren
 * - Zero-Width und unsichtbare Zeichen entfernen
 * - Combining Diacritical Marks entfernen
 * - Steuerzeichen entfernen
 * - Doppelte Leerzeichen konsolidieren
 */

const WIN1252_MAP = [
  [/\u201E/g, 'ä'],
  [/\u201C/g, 'ü'],
  [/\u00E4/g, 'ä'],
  [/\u00F6/g, 'ö'],
  [/\u00FC/g, 'ü'],
  [/\u00C4/g, 'Ä'],
  [/\u00D6/g, 'Ö'],
  [/\u00DC/g, 'Ü'],
  [/\u00DF/g, 'ß'],
  [/verd[\u201E"]chtiger?/gi, 'verdächtiger'],
  [/Stra[\u201E"]e/gi, 'Straße'],
  [/Geb[\u201E"]ude/gi, 'Gebäude'],

  // Fehlkodierungen aus den aktuellen Leitstellenmeldungen.
  [/WF-S\u0081d/gi, 'WF-Süd'],
  [/WF-Fl\u201Dthe/gi, 'WF-Flöthe'],
  [/Wolfenb\u0081ttel/gi, 'Wolfenbüttel'],
  [/Betriebsfl\u0081ssigke/gi, 'Betriebsflüssigke'],
  [/Straáe/gi, 'Straße'],
];

const INVISIBLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180D\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFA0]/g;

function cleanUnicode(text) {
  if (!text) return '';

  let result = text.normalize('NFC');

  for (const [pattern, replacement] of WIN1252_MAP) {
    result = result.replace(pattern, replacement);
  }

  result = result.replace(INVISIBLE_RE, '');
  result = result.replace(/[\u0300-\u036F]/g, '');
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  result = result.replace(/[\x80-\x9F]/g, '');
  result = result.replace(/[ \t]+/g, ' ');

  return result.trim();
}

module.exports = { cleanUnicode };
