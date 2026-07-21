'use strict';

/**
 * Mapping: Straßenkürzel + Leitstellen-Abkürzungen → natürliche deutsche Aussprache.
 *
 * Straßen:
 *   Autobahnen    (A2, A39, A391)
 *   Bundesstraßen (B6, B248)
 *   Landesstraßen (L615)
 *   Kreisstraßen  (K53)
 *
 * Zahlen < 100 als Zahlwort, Landesstraßen immer als Zahlwort,
 * alle anderen >= 100 ziffernweise.
 *
 * Leitstellen-Abkürzungen (werden in Beschreibung + Bemerkung aufgelöst):
 *   VP  → verletzter Person
 *   VU  → Verkehrsunfall
 *   PKW → Personenkraftwagen
 *   LKW → Lastkraftwagen
 *   Pol.→ Polizei
 *   Pat.→ Patient
 *   RD  → Rettungsdienst
 *   FW  → Feuerwehr
 *   HP  → hilflose Person
 *   AS  → Anschlussstelle
 *   usw.
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

function digitByDigit(numStr) {
  return numStr.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
}

const ABBREVIATION_MAP = [
  // -----------------------------------------------------------------------
  // Leitstellen-Fachkürzel (vor allgemeinen Abkürzungen ausführen)
  // -----------------------------------------------------------------------
  [/\bVU\b/g,                         'Verkehrsunfall'],
  [/\bVP\b/g,                         'verletzter Person'],
  [/\bPKW\b/gi,                       'Personenkraftwagen'],
  [/\bLKW\b/gi,                       'Lastkraftwagen'],
  [/\bKrad\b/gi,                      'Kraftrad'],
  [/\bHP\b/g,                         'hilflose Person'],
  [/\bRD\b/g,                         'Rettungsdienst'],
  [/\bFW\b/g,                         'Feuerwehr'],
  [/\bPol\.?\b/gi,                    'Polizei'],
  [/\bPat\.?\b/gi,                    'Patient'],
  [/\bRTW\b/g,                        'Rettungswagen'],
  [/\bNEF\b/g,                        'Notarzteinsatzfahrzeug'],
  [/\bNA\b/g,                         'Notarzt'],
  [/\bELW\b/g,                        'Einsatzleitwagen'],
  [/\bMTF\b/g,                        'Mannschaftstransportfahrzeug'],
  [/\bPA-Träger\b/gi,                'Pressluftatmer-Träger'],
  [/\bPA\b/g,                         'Pressluftatmer'],
  [/\bAirbags?\b/gi,                  'Airbags'],
  [/\bE-Call\b/gi,                    'E-Call'],
  [/\bAS\b/g,                         'Anschlussstelle'],
  [/\bSprechverb\.?\b/gi,             'Sprechverbindung'],
  [/\bBetriebsflüss?\.?\b/gi,        'Betriebsflüssigkeiten'],
  // -----------------------------------------------------------------------
  // Allgemeine Abkürzungen
  // -----------------------------------------------------------------------
  [/\bStr\.?\b/g,                     'Straße'],
  [/\bHsNr\.?\b/gi,                   'Hausnummer'],
  [/\bNr\.\s*(\d+)/g,                 (_, n) => 'Nummer ' + numberToWords(parseInt(n, 10))],
  [/\bkm\b/g,                         'Kilometer'],
  [/\bca\.\b/gi,                      'circa'],
  [/\bggf\.\b/gi,                     'gegebenenfalls'],
  [/\bbzw\.\b/gi,                     'beziehungsweise'],
  [/\bevtl?\.\b/gi,                   'eventuell'],
  [/\bggü\.\b/gi,                    'gegenüber'],
  [/\bEcke\b/gi,                      'Ecke'],
  [/\bOT\b/g,                         'Ortsteil'],
  [/\bLkr\.?\b/gi,                    'Landkreis'],
  [/\bGem\.\b/gi,                     'Gemeinde'],
  [/\bGeb\.\b/gi,                     'Gebäude'],
  [/\bEG\b/g,                         'Erdgeschoss'],
  [/\bOG(\d?)\b/g,  (_, n) => n ? 'Obergeschoss ' + numberToWords(parseInt(n, 10)) : 'Obergeschoss'],
  [/\bUG\b/g,                         'Untergeschoss'],
  [/\bDG\b/g,                         'Dachgeschoss'],
];

function replaceRoadCodes(text) {
  return text.replace(/\b([ABLKSE])(\d{1,4})\b/g, (match, prefix, numStr) => {
    const roadType = ROAD_PREFIXES[prefix];
    if (!roadType) return match;
    const num = parseInt(numStr, 10);
    const numSpoken = prefix === 'L' || num < 100
      ? numberToWords(num)
      : digitByDigit(numStr);
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
