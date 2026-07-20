'use strict';

/**
 * Mapping: Feuerwehr-Alarmstufen → ausgeschriebene deutsche Bezeichnung.
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
  'THB':  'Technische Hilfe Baum',
  'THV':  'Technische Hilfe Verkehr',

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

function getAlarmLabel(code) {
  return ALARM_MAPPING[code.toUpperCase()] || null;
}

/**
 * Ersetzt alle bekannten Alarmstichwörter im Text.
 * Unterstützt sowohl kompakte ('B2') als auch getrennte ('B 2') Schreibweise.
 * @param {string} text
 * @returns {string}
 */
function replaceAlarmCodes(text) {
  // Schritt 1: 'B 2' -> 'B2' normalisieren (Buchstaben direkt gefolgt von Leerzeichen+Zahl)
  // Nur am Wortanfang (nach Zeilenstart, Satzzeichen oder Leerzeichen)
  let result = text.replace(
    /(^|[\s.,;!?])([A-Z]+)\s+(\d+)(?=[\s.,;!?]|$)/g,
    (match, pre, letters, digits) => {
      const compact = letters + digits;
      // Nur normalisieren wenn der kompakte Code im Mapping existiert
      if (ALARM_MAPPING[compact]) return pre + compact;
      return match;
    }
  );

  // Schritt 2: kompakte Codes ersetzen
  result = result.replace(/\b([A-Z]+\d+|[A-Z]{2,})\b/g, (match) => {
    return ALARM_MAPPING[match] || match;
  });

  return result;
}

module.exports = { ALARM_MAPPING, getAlarmLabel, replaceAlarmCodes };
