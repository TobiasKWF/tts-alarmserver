'use strict';

/**
 * @file tts/mappings/alarmMapping.js
 * @description Feuerwehr-Codes und Abkürzungen → ausgeschriebene deutsche Bezeichnung.
 *
 * Quellen: alarmMapping.js + config/normalization.json (zusammengeführt)
 *
 * Zwei Tabellen:
 *   ALARM_MAPPING  – Alarmstufen/Codes am Textanfang   (B2, TH, VU-1, H VU-1 …)
 *   INLINE_ABBR    – Abkürzungen im Freitext           (VP, LKW, BAB, OG …)
 */

// ---------------------------------------------------------------------------
// Alarm-Code-Mapping (Alarmstufen, Einsatzarten)
// ---------------------------------------------------------------------------

const ALARM_MAPPING = {
  // --- Menschengefährdungs-Suffix ---
  'Y': 'Menschenleben in Gefahr',

  // --- Brand ---
  'B1':     'Brand eins',
  'B2':     'Brand zwei',
  'B2Y':    'Brand zwei mit Menschengefährdung',
  'B3':     'Brand drei',
  'B3Y':    'Brand drei mit Menschengefährdung',
  'B4':     'Brand vier',
  'B4Y':    'Brand vier mit Menschengefährdung',
  'B5':     'Brand fünf',
  'BMA':    'Brandmeldeanlage',
  'BBMA':   'Brand Brandmeldeanlage',
  'BWALD1': 'Waldbrand klein',
  'BWALD2': 'Waldbrand mittel',
  'BKFZ':   'Fahrzeugbrand',

  // --- Technische Hilfe ---
  'TH':    'Technische Hilfe',
  'TH1':   'Technische Hilfe eins',
  'TH2':   'Technische Hilfe zwei',
  'TH3':   'Technische Hilfe drei',
  'TH4':   'Technische Hilfe vier',
  'THB':   'Technische Hilfe Baum',
  'THV':   'Technische Hilfe Verkehr',
  'THOEL1':'Technische Hilfe Ölspur klein',
  'THOEL2':'Technische Hilfe Ölspur mittel',
  'HZUG2Y':'Hilfeleistung Zugunfall mit Menschengefährdung',

  // --- Hilfeleistung ---
  'H0':   'Hilfeleistung Lageerkundung',
  'H1':   'Hilfeleistung klein',
  'H2':   'Hilfeleistung mittel',
  'H2Y':  'Hilfeleistung mittel mit Menschengefährdung',
  'H3':   'Hilfeleistung groß',
  'H3Y':  'Hilfeleistung groß mit Menschengefährdung',

  // --- Verkehrsunfall ---
  'VU':    'Verkehrsunfall',
  'VU1':   'Verkehrsunfall eins',
  'VU2':   'Verkehrsunfall zwei',
  'VU3':   'Verkehrsunfall drei',
  'VU4':   'Verkehrsunfall vier',
  'VUE':   'Verkehrsunfall mit eingeklemmter Person',
  'HVU':   'Verkehrsunfall',
  'HVU1':  'Verkehrsunfall eins',
  'HVU2':  'Verkehrsunfall zwei',
  'HVU3':  'Verkehrsunfall drei',
  'HVU4':  'Verkehrsunfall vier',

  // --- Rettungsdienst ---
  'RD':   'Rettungsdienst',
  'NA':   'Notarzt',
  'MANV': 'Massenanfall von Verletzten',
  'MANV1':'Massenanfall von Verletzten eins',
  'MANV2':'Massenanfall von Verletzten zwei',
  'MV0':  'Massenanfall von Verletzten, Alarmierung ÖEL und Rettungsdienst',

  // --- Gefahrgut / ABC ---
  'ABC':   'ABC-Einsatz',
  'ABC1':  'ABC-Lage eins',
  'ABC2':  'ABC-Lage zwei',
  'CBRN':  'Gefahrstoffeinsatz',
  'GSG':   'Gefahrguteinsatz',
  'DEKON': 'Dekontaminationseinsatz',
  'G':     'Gefahrstoff',
  'G1':    'Gefahrstoff eins',
  'G2':    'Gefahrstoff zwei',

  // --- Wasserrettung ---
  'WR':   'Wasserrettung',
  'WR1':  'Wasserrettung eins',
  'W':    'Wasserrettung',
  'WY':   'Wasserrettung mit Menschengefährdung',

  // --- Tier / Sonstiges ---
  'TIN':      'Tier in Not',
  'UW':       'Unwetterlage',
  'TUEROFF':  'Türöffnung',
  'PSNV':     'Psychosoziale Notfallversorgung',
  'SPERSUS':  'Drohneneinsatz Personensuche',
};

// ---------------------------------------------------------------------------
// Inline-Abkürzungen (Freitext-Ersetzungen, Reihenfolge beachten)
// ---------------------------------------------------------------------------

const INLINE_ABBR = [
  // Kombinierte VU+VP Codes – müssen VOR den Einzelregeln stehen damit
  // VP nicht isoliert als Nominativ ersetzt wird, sondern grammatikalisch
  // korrekt als Dativ "mit verletzter Person" erscheint.
  [/\bVU1\s+VP\b/gi,  'Verkehrsunfall eins mit verletzter Person'],
  [/\bVU2\s+VP\b/gi,  'Verkehrsunfall zwei mit verletzter Person'],
  [/\bVU3\s+VP\b/gi,  'Verkehrsunfall drei mit verletzter Person'],
  [/\bVU4\s+VP\b/gi,  'Verkehrsunfall vier mit verletzter Person'],
  [/\bVUE\s+VP\b/gi,  'Verkehrsunfall mit eingeklemmter und verletzter Person'],
  [/\bHVU1\s+VP\b/gi, 'Verkehrsunfall eins mit verletzter Person'],
  [/\bHVU2\s+VP\b/gi, 'Verkehrsunfall zwei mit verletzter Person'],
  [/\bHVU3\s+VP\b/gi, 'Verkehrsunfall drei mit verletzter Person'],
  [/\bHVU4\s+VP\b/gi, 'Verkehrsunfall vier mit verletzter Person'],
  [/\bVU\s+VP\b/gi,   'Verkehrsunfall mit verletzter Person'],
  [/\bHVU\s+VP\b/gi,  'Verkehrsunfall mit verletzter Person'],

  // Kombinierte VU+VPs (mehrere verletzte Personen)
  [/\bVU1\s+VPs\b/gi,  'Verkehrsunfall eins mit verletzten Personen'],
  [/\bVU2\s+VPs\b/gi,  'Verkehrsunfall zwei mit verletzten Personen'],
  [/\bVU3\s+VPs\b/gi,  'Verkehrsunfall drei mit verletzten Personen'],
  [/\bVU4\s+VPs\b/gi,  'Verkehrsunfall vier mit verletzten Personen'],
  [/\bVU\s+VPs\b/gi,   'Verkehrsunfall mit verletzten Personen'],

  // Personen (allein im Freitext, Nominativ korrekt)
  [/\bVP\b/g,              'verletzte Person'],
  [/\bVPs\b/g,             'verletzte Personen'],
  [/\bMP\b/g,              'mehrere Personen'],

  // Organisationen
  [/\bDRK\b/g,             'Deutsches Rotes Kreuz'],
  [/\bASB\b/g,             'Arbeiter-Samariter-Bund'],
  [/\bJUH\b/g,             'Johanniter-Unfall-Hilfe'],
  [/\bMHD\b/g,             'Malteser Hilfsdienst'],
  [/\bDLRG\b/g,            'Deutsche Lebens-Rettungs-Gesellschaft'],
  [/\bTHW\b/g,             'Technisches Hilfswerk'],
  [/\bPOL\b/g,             'Polizei'],
  [/\bFW\b/g,              'Feuerwehr'],
  [/\bFF\b/g,              'Freiwillige Feuerwehr'],
  [/\bBF\b/g,              'Berufsfeuerwehr'],
  [/\bJF\b/g,              'Jugendfeuerwehr'],

  // Fahrzeuge
  [/\bPKW\b/gi,            'Personenkraftwagen'],
  [/\bLKW\b/gi,            'Lastkraftwagen'],
  [/\bKFZ\b/gi,            'Kraftfahrzeug'],
  [/\bDLK\b/g,             'Drehleiter'],
  [/\bELW1\b/g,            'Einsatzleitwagen eins'],
  [/\bELW2\b/g,            'Einsatzleitwagen zwei'],
  [/\bELW\b/g,             'Einsatzleitwagen'],
  [/\bHLF20\b/g,           'Hilfeleistungslöschfahrzeug zwanzig'],
  [/\bHLF10\b/g,           'Hilfeleistungslöschfahrzeug zehn'],
  [/\bHLF\b/g,             'Hilfeleistungslöschfahrzeug'],
  [/\bLF20\b/g,            'Löschfahrzeug zwanzig'],
  [/\bLF10\b/g,            'Löschfahrzeug zehn'],
  [/\bLF\b/g,              'Löschfahrzeug'],
  [/\bTLF3000\b/g,         'Tanklöschfahrzeug dreitausend'],
  [/\bTLF\b/g,             'Tanklöschfahrzeug'],
  [/\bRW\b/g,              'Rüstwagen'],
  [/\bMTF\b/g,             'Mannschaftstransportfahrzeug'],
  [/\bKdoW\b/gi,           'Kommandowagen'],
  [/\bAB\b/g,              'Abrollbehälter'],
  [/\bGW-L2\b/gi,          'Gerätewagen Logistik'],
  [/\bGW-G\b/gi,           'Gerätewagen Gefahrgut'],
  [/\bGW-A\b/gi,           'Gerätewagen Atemschutz'],
  [/\bWBK\b/g,             'Wärmebildkamera'],

  // Rettungsdienst-Fahrzeuge
  [/\bRTW\b/g,             'Rettungswagen'],
  [/\bKTW\b/g,             'Krankentransportwagen'],
  [/\bNEF\b/g,             'Notarzteinsatzfahrzeug'],
  [/\bNAW\b/g,             'Notarztwagen'],
  [/\bNKTW\b/g,            'Notfall-Krankentransportwagen'],
  [/\bITW\b/g,             'Intensivtransportwagen'],
  [/\bMZF\b/g,             'Mehrzweckfahrzeug'],
  [/\bBHP\b/g,             'Behandlungsplatz'],
  [/\bSEG\b/g,             'Schnelleinsatzgruppe'],
  [/\bLNA\b/g,             'Leitender Notarzt'],
  [/\bORGL\b/g,            'Organisatorischer Leiter Rettungsdienst'],
  [/\b[ÖO]EL\b/g,         'Örtliche Einsatzleitung'],
  [/\bOEGL\b/g,            'Örtliche Einsatzleitung'],

  // Straßen
  [/\bBAB\b/g,             'Bundesautobahn'],
  [/\bAS\b/g,              'Anschlussstelle'],
  [/\bAK\b/g,              'Autobahnkreuz'],
  [/\bAD\b/g,              'Autobahndreieck'],
  [/\bFR\b/g,              'Fahrtrichtung'],
  [/\bKM\b/g,              'Kilometer'],

  // Gebäudeteile
  [/\bOG\s*(\d+)\b/g,      (_, n) => `Obergeschoss ${n}`],
  [/\bOG\b/g,              'Obergeschoss'],
  [/\bUG\b/g,              'Untergeschoss'],
  [/\bEG\b/g,              'Erdgeschoss'],
  [/\bDG\b/g,              'Dachgeschoss'],
  [/\bKG\b/g,              'Kellergeschoss'],
  [/\bGEB\b/gi,            'Gebäude'],
  [/\bOBJ\b/gi,            'Objekt'],

  // Einsatzbegriffe
  [/\bVU\b/g,              'Verkehrsunfall'],
  [/\bVU-E\b/g,            'Verkehrsunfall mit eingeklemmter Person'],
  [/\bTÜR\b/gi,            'Türöffnung'],
];

// ---------------------------------------------------------------------------

function getAlarmLabel(code) {
  return ALARM_MAPPING[code.toUpperCase()] || null;
}

/**
 * Ersetzt Alarm-Codes und Inline-Abkürzungen im Text.
 * Unterstützt kompakte ('B2') und getrennte ('B 2', 'H VU-1') Schreibweise.
 */
function replaceAlarmCodes(text) {
  let result = text;

  // 1. Bindestrich-Varianten + mehrteilige Codes normalisieren:
  //    'VU-1' -> 'VU1',  'H VU-1' -> 'HVU1',  'B WALD-2' -> 'BWALD2'
  result = result.replace(
    /(^|[\s])([A-ZÄÖÜ]+)(?:\s+([A-ZÄÖÜ]+))?[-\s](\d+Y?)(?=[\s.,;!?]|$)/g,
    (match, pre, p1, p2, digits) => {
      const c1 = (p1 + (p2 || '') + digits).toUpperCase();
      if (ALARM_MAPPING[c1]) return pre + c1;
      const c2 = (p1 + digits).toUpperCase();
      if (ALARM_MAPPING[c2]) return pre + c2;
      return match;
    }
  );

  // 2. Leerzeichen zwischen Buchstaben und Ziffer: 'B 2' -> 'B2'
  result = result.replace(
    /(^|[\s])([A-ZÄÖÜ]+)\s+(\d+Y?)(?=[\s.,;!?]|$)/g,
    (match, pre, letters, digits) => {
      const compact = (letters + digits).toUpperCase();
      if (ALARM_MAPPING[compact]) return pre + compact;
      return match;
    }
  );

  // 3. Mehrteilige Codes ohne Zahl: 'H VU' -> 'HVU',  'B BMA' -> 'BBMA'
  result = result.replace(
    /(^|[\s])([A-Z])\s+([A-Z]{2,})(\d*Y?)(?=[\s.,;!?]|$)/g,
    (match, pre, letter, rest, digits) => {
      const compact = (letter + rest + digits).toUpperCase();
      if (ALARM_MAPPING[compact]) return pre + compact;
      return match;
    }
  );

  // 4. Kompakte Codes ersetzen
  result = result.replace(/\b([A-ZÄÖÜ]+\d*Y?)\b/g, (match) => {
    return ALARM_MAPPING[match.toUpperCase()] || match;
  });

  // 5. Inline-Abkürzungen im Freitext
  for (const [pattern, replacement] of INLINE_ABBR) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

module.exports = { ALARM_MAPPING, INLINE_ABBR, getAlarmLabel, replaceAlarmCodes };
