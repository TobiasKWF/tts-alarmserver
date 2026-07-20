'use strict';

/**
 * Mapping: Straßenkürzel → natürliche deutsche Aussprache.
 *
 * Abgedeckt:
 *   Autobahnen    (A2, A39, A391)
 *   Bundesstraßen (B6, B248)
 *   Landesstraßen (L615)
 *   Kreisstraßen  (K53)
 *   Straßenabkürzungen (Str., HsNr., …)
 *
 * Zahlen < 100      werden als Ganzzahl gesprochen  (A36  → Autobahn sechsunddreißig)
 * Landesstraßen     werden IMMER als Ganzzahl gesprochen
 *                   (L495 → Landesstraße vierhundertfünfundneunzig)
 * Alle anderen >= 100 werden ziffernweise gesprochen (A391 → Autobahn drei neun eins)
 *
 * Hintergrund: Bei Durchsagen ist „vierhundertfünfundneunzig" deutlich
 * besser verständlich als „vier neun fünf".
 */

const { numberToWords } = require('../../utils/numbers');

const ROAD_PREFIXES = {
  A: 'Autobahn',
  B: 'Bundesstraße',
  L: 'Landesstraße',
  K: 'Kreisstraße',
  S: 'Staatsstraße',
  E: 'Europastraße',
};

const DIGIT_WORDS = {
  '0': 'null', '1': 'eins', '2': 'zwei', '3': 'drei', '4': 'vier',
  '5': 'fünf', '6': 'sechs', '7': 'sieben', '8': 'acht', '9': 'neun',
};

/** Spricht eine Zahl ziffernweise aus (A391 → "drei neun eins"). */
function digitByDigit(numStr) {
  return numStr.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
}

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
 * Landesstraßen (L) werden stets als Zahlwort gesprochen.
 * Alle anderen Typen >= 100 werden ziffernweise gesprochen.
 */
function replaceRoadCodes(text) {
  return text.replace(/\b([ABLKSE])(\d{1,4})\b/g, (match, prefix, numStr) => {
    const roadType = ROAD_PREFIXES[prefix];
    if (!roadType) return match;
    const num = parseInt(numStr, 10);
    let numSpoken;
    if (prefix === 'L') {
      // Landesstraßen immer als vollständiges Zahlwort für bessere Verständlichkeit
      numSpoken = numberToWords(num);
    } else {
      numSpoken = num < 100 ? numberToWords(num) : digitByDigit(numStr);
    }
    return roadType + ' ' + numSpoken;
  });
}

function replaceAbbreviations(text) {
  let result = text;
  for (const [pattern, replacement] of ABBREVIATION_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

module.exports = { replaceRoadCodes, replaceAbbreviations, ROAD_PREFIXES, ABBREVIATION_MAP };
