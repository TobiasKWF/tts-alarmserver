'use strict';

/**
 * Mapping: Feuerwehr-Alarmstufen → ausgeschriebene deutsche Bezeichnung.
 *
 * Wird in normalizationService.js und speechEnhancer.js verwendet.
 * Neue Einträge hier ergänzen – kein Code-Änderung nötig.
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

/**
 * Gibt die ausgeschriebene Bezeichnung für ein Alarmstichwort zurück.
 * @param {string} code - z.B. 'B2'
 * @returns {string|null}
 */
function getAlarmLabel(code) {
  return ALARM_MAPPING[code.toUpperCase()] || null;
}

/**
 * Ersetzt alle bekannten Alarmstichwörter am Anfang einer Zeile.
 * @param {string} text
 * @returns {string}
 */
function replaceAlarmCodes(text) {
  // Nur am Wortanfang ersetzen, damit z.B. "B2-Lage" korrekt behandelt wird
  return text.replace(/\b([A-Z]+\d*)\b/g, (match) => {
    return ALARM_MAPPING[match] || match;
  });
}

module.exports = { ALARM_MAPPING, getAlarmLabel, replaceAlarmCodes };
