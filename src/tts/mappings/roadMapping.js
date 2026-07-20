'use strict';

/**
 * Mapping: Straßenkürzel → natürliche deutsche Aussprache.
 *
 * Abgedeckt:
 *   Autobahnen  (A2, A39, A391)
 *   Bundesstraßen (B6, B248)
 *   Landesstraßen (L615)
 *   Kreisstraßen (K53)
 *   Straßenabkürzungen (Str., HsNr., …)
 */

const { numberToWords } = require('../../utils/numbers');

/**
 * Präfix-Mapping für Straßentypen.
 * Key: Buchstabe(n), Value: ausgeschriebener Typ
 */
const ROAD_PREFIXES = {
  A:  'Autobahn',
  B:  'Bundesstraße',
  L:  'Landesstraße',
  K:  'Kreisstraße',
  S:  'Staatsstraße',
  E:  'Europastraße',
};

/**
 * Allgemeine Abkürzungsersetzungen (Straße, Platz, etc.)
 */
const ABBREVIATION_MAP = [
  [/\bStr\.?\b/g,    'Straße'],
  [/\bHsNr\.?\b/gi, 'Hausnummer'],
  [/\bNr\.\s*(\d+)/g, (_, n) => 'Nummer ' + numberToWords(parseInt(n, 10))],
  [/\bkm\b/g,       'Kilometer'],
  [/\bca\.\b/gi,    'circa'],
  [/\bggf\.\b/gi,   'gegebenenfalls'],
  [/\bbzw\.\b/gi,   'beziehungsweise'],
  [/\bEvtl\.\b/gi,  'eventuell'],
  [/\bevtl\.\b/gi,  'eventuell'],
  [/\bggü\.\b/gi,   'gegenüber'],
  [/\bEcke\b/gi,    'Ecke'],
  [/\bOT\b/g,       'Ortsteil'],
  [/\bLkr\.?\b/gi,  'Landkreis'],
  [/\bGem\.\b/gi,   'Gemeinde'],
  [/\bGeb\.\b/gi,   'Gebäude'],
  [/\bEG\b/g,       'Erdgeschoss'],
  [/\bOG(\d?)\b/g,  (_, n) => n ? 'Obergeschoss ' + numberToWords(parseInt(n, 10)) : 'Obergeschoss'],
  [/\bUG\b/g,       'Untergeschoss'],
];

/**
 * Ersetzt Straßenkennzeichnungen im Text durch natürliche Sprache.
 * Beispiel: "A2" → "Autobahn zwei", "L615" → "Landesstraße sechshundertfünfzehn"
 * @param {string} text
 * @returns {string}
 */
function replaceRoadCodes(text) {
  return text.replace(/\b([ABLKSE])(\d{1,4})\b/g, (match, prefix, numStr) => {
    const roadType = ROAD_PREFIXES[prefix];
    if (!roadType) return match;
    const num = parseInt(numStr, 10);
    return roadType + ' ' + numberToWords(num);
  });
}

/**
 * Ersetzt allgemeine Straßenabkürzungen.
 * @param {string} text
 * @returns {string}
 */
function replaceAbbreviations(text) {
  let result = text;
  for (const [pattern, replacement] of ABBREVIATION_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

module.exports = { replaceRoadCodes, replaceAbbreviations, ROAD_PREFIXES, ABBREVIATION_MAP };
