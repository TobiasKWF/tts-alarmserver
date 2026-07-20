'use strict';

/**
 * Mapping: Feuerwehr-Alarmstufen und Abkürzungen → ausgeschriebene deutsche Bezeichnung.
 */

const ALARM_MAPPING = {
  // Brand
  'B1':  'Brand eins',
  'B2':  'Brand zwei',
  'B3':  'Brand drei',
  'B4':  'Brand vier',
  'B5':  'Brand fünf',
  'BMA': 'Brandmeldeanlage',
  'BKFZ': 'Brandfahrzeug',

  // Technische Hilfe
  'TH':   'Technische Hilfe',
  'TH1':  'Technische Hilfe eins',
  'TH2':  'Technische Hilfe zwei',
  'TH3':  'Technische Hilfe drei',
  'TH4':  'Technische Hilfe vier',
  'THB':  'Technische Hilfe Baum',
  'THV':  'Technische Hilfe Verkehr',

  // Verkehrsunfall (H VU / VU / HVU)
  'VU':   'Verkehrsunfall',
  'VU1':  'Verkehrsunfall eins',
  'VU2':  'Verkehrsunfall zwei',
  'VU3':  'Verkehrsunfall drei',
  'VU4':  'Verkehrsunfall vier',
  'HVU':  'Verkehrsunfall',
  'HVU1': 'Verkehrsunfall eins',
  'HVU2': 'Verkehrsunfall zwei',
  'HVU3': 'Verkehrsunfall drei',
  'HVU4': 'Verkehrsunfall vier',

  // Hilfeleistung
  'H1':  'Hilfeleistung eins',
  'H2':  'Hilfeleistung zwei',
  'H3':  'Hilfeleistung drei',

  // Rettungsdienst
  'RD':   'Rettungsdienst',
  'NA':   'Notarzt',

  // MANV
  'MANV1': 'Massenanfall von Verletzten eins',
  'MANV2': 'Massenanfall von Verletzten zwei',

  // Gefahrgut
  'ABC1': 'ABC-Lage eins',
  'ABC2': 'ABC-Lage zwei',
  'G':    'Gefahrstoff',
  'G1':   'Gefahrstoff eins',
  'G2':   'Gefahrstoff zwei',

  // Wasserrettung
  'WR':   'Wasserrettung',
  'WR1':  'Wasserrettung eins',

  // Tier in Not
  'TIN':  'Tier in Not',

  // Unwetter
  'UW':   'Unwetterlage',
};

/**
 * Inline-Abkürzungen die im Freitext vorkommen (nicht als Alarmstufe am Anfang).
 * Werden nach dem Alarm-Code-Mapping ersetzt.
 */
const INLINE_ABBR = [
  // Personenbezüge
  [/\bVP\b/g,   'verletzte Person'],
  [/\bVPs\b/g,  'verletzte Personen'],
  [/\bMP\b/g,   'mehrere Personen'],
  // Fahrzeugbezüge
  [/\bKFZ\b/gi, 'Kraftfahrzeug'],
  [/\bPKW\b/gi, 'Personenkraftwagen'],
  [/\bLKW\b/gi, 'Lastkraftwagen'],
  // Einsatzbegriffe
  [/\bVU\b/g,   'Verkehrsunfall'],
  [/\bausl\.?\s*Betriebsflüssigkeiten\b/gi, 'auslaufende Betriebsflüssigkeiten'],
  [/\bABfl\.?\b/gi, 'auslaufende Betriebsflüssigkeiten'],
];

function getAlarmLabel(code) {
  return ALARM_MAPPING[code.toUpperCase()] || null;
}

/**
 * Schritt 1: 'H VU-1' / 'B 2' (Leerzeichen/Bindestrich zwischen Code und Ziffer) normalisieren.
 * Schritt 2: Kompakte Codes aus ALARM_MAPPING ersetzen.
 * Schritt 3: Inline-Abkürzungen im Freitext ersetzen.
 */
function replaceAlarmCodes(text) {
  let result = text;

  // Bindestrich-Varianten normalisieren: 'VU-1' -> 'VU1', 'H VU-1' -> 'HVU1'
  result = result.replace(
    /(^|[\s])([A-Z]+)(?:\s+([A-Z]+))?[-\s](\d+)(?=[\s.,;!?]|$)/g,
    (match, pre, part1, part2, digits) => {
      const compact = (part1 + (part2 || '') + digits).toUpperCase();
      if (ALARM_MAPPING[compact]) return pre + compact;
      // Leerzeichen-Variante ohne Teil2: 'B 2' -> 'B2'
      const compact2 = (part1 + digits).toUpperCase();
      if (ALARM_MAPPING[compact2]) return pre + compact2;
      return match;
    }
  );

  // Mehrteilige Codes mit Leerzeichen: 'H VU' -> 'HVU'
  result = result.replace(
    /(^|[\s])([A-Z])\s+([A-Z]{2,})(\d*)(?=[\s.,;!?]|$)/g,
    (match, pre, letter, rest, digits) => {
      const compact = (letter + rest + digits).toUpperCase();
      if (ALARM_MAPPING[compact]) return pre + compact;
      return match;
    }
  );

  // Kompakte Codes ersetzen
  result = result.replace(/\b([A-Z]+\d+|[A-Z]{2,})\b/g, (match) => {
    return ALARM_MAPPING[match] || match;
  });

  // Inline-Abkürzungen im Freitext
  for (const [pattern, replacement] of INLINE_ABBR) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

module.exports = { ALARM_MAPPING, getAlarmLabel, replaceAlarmCodes };
