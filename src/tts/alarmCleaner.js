'use strict';

/**
 * Alarmtext-Bereinigung.
 *
 * Entfernt alle nicht-relevanten Sektionen aus einem Alarmtext.
 * Behalten werden NUR:
 *   - Alarmtext (erste Zeile / Einsatzstichwort)
 *   - Einsatzort
 *   - Einsatzortzusatz (z.B. "OG 2", "EG", "Hinterhaus", "Tor 3")
 *
 * Alles andere (Datum, Zeit, Einheiten, Fahrzeuge, Status …) wird verworfen.
 *
 * Die Regeln sind in SECTION_PATTERNS / LINE_PATTERNS gepflegt und leicht erweiterbar.
 */

/**
 * Regex-Muster für Sektions-Header, die den Beginn einer zu entfernenden Sektion markieren.
 * Alles von diesem Header bis zum nächsten bekannten Header (oder Dateiende) wird verworfen.
 */
const SECTION_PATTERNS = [
  /^-{3,}\s*Einheiten\s*-{3,}/i,
  /^-{3,}\s*Fahrzeuge\s*-{3,}/i,
  /^-{3,}\s*Kräfte\s*-{3,}/i,
  /^-{3,}\s*Schleifen\s*-{3,}/i,
  /^-{3,}\s*Rückmeldungen\s*-{3,}/i,
  /^-{3,}\s*Status\s*-{3,}/i,
  /^-{3,}\s*Alarmierung\s*-{3,}/i,
];

/**
 * Einzelzeilen-Muster: Zeilen, die diesem Muster entsprechen, werden vollständig entfernt.
 */
const LINE_PATTERNS = [
  /^Datum[:\s]/i,
  /^Zeit[:\s]/i,
  /^Einsatznummer[:\s]/i,
  /^Einsatz(?:nummer)?[:\s]/i,
  /^Priorität[:\s]/i,
  /^Sondersignal[:\s]/i,
  /^Alarmierung[:\s]/i,
  /^Status[:\s]/i,
  /^Rückmeldung/i,
  /^Schleifen?[:\s]/i,
  /^Kräfte[:\s]/i,
  // Fahrzeugkennzeichen-Muster: z.B. "WF 21-43-8", "LF 10", "HLF 20"
  /^(?:WF|LF|HLF|TLF|DLK|RW|GW|KTW|RTW|NEF|ELW|MTF|TSF|MLF)\s+\d/i,
  // Rufnamen/Funkrufnamen
  /^Florian\s/i,
  /^Heros\s/i,
  /^Rotkreuz\s/i,
  // leere Zeilen oder nur Trennstriche
  /^[-=*_]{3,}$/,
];

/**
 * Markiert den Beginn des Ortsbereichs.
 */
const ORT_PATTERN = /^(?:Ort|Einsatzort|Adresse)[:\s]/i;

/**
 * Markiert den Beginn des Ortzusatz-Bereichs (Gebäudeteil, Stockwerk, Zufahrt …).
 * Erkannte Schlüsselwörter:
 *   Ortzusatz / Einsatzortzusatz / Zusatz / Objekt / Gebäude / Etage / Stockwerk
 */
const ORT_ADDITIONAL_PATTERN = /^(?:Ortzusatz|Einsatzortzusatz|Zusatz|Objekt|Gebäude|Etage|Stockwerk)[:\s]/i;

/**
 * Inline-Einsatzortzusatz: Texte am Ende einer Adresszeile, die auf einen
 * Gebäudeteil oder Stockwerk hinweisen.
 * Beispiele: "Musterstr. 12 OG 2", "Hauptstraße 5 EG", "Bahnhofstr. 3 Hinterhaus"
 */
const ORT_INLINE_ZUSATZ_PATTERN =
  /\b(EG|UG|DG|(?:OG|UG|Stock)\s*\d*|Hinterhaus|Vorderhaus|Seitenflügel|Tor\s*\d+|Aufgang\s*\d+|Eingang\s*\w+|Halle\s*\d*)$/i;

/**
 * Extrahiert Alarmtext, Einsatzort und optionalen Einsatzortzusatz aus dem Rohtext.
 * @param {string} rawText - Ungefilterte Alarm-Nachricht
 * @returns {{ alarmText: string, location: string, locationAdditional: string }}
 */
function extractAlarmInfo(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim());

  let alarmText = '';
  let locationLines = [];
  let locationAdditionalLines = [];
  let inLocation = false;
  let inLocationAdditional = false;
  let inRemovedSection = false;

  for (const line of lines) {
    // Leere Zeile
    if (!line) {
      if (inLocation) locationLines.push('');
      continue;
    }

    // Beginn einer zu entfernenden Sektion
    if (SECTION_PATTERNS.some(p => p.test(line))) {
      inRemovedSection = true;
      inLocation = false;
      inLocationAdditional = false;
      continue;
    }

    // Ende einer entfernten Sektion: nächste bekannte Sektion
    if (inRemovedSection) {
      if (ORT_PATTERN.test(line)) {
        inRemovedSection = false;
        inLocation = true;
        inLocationAdditional = false;
        continue;
      }
      if (ORT_ADDITIONAL_PATTERN.test(line)) {
        inRemovedSection = false;
        inLocationAdditional = true;
        inLocation = false;
        continue;
      }
      continue;
    }

    // Einsatzortzusatz-Sektion beginnt
    if (ORT_ADDITIONAL_PATTERN.test(line)) {
      inLocationAdditional = true;
      inLocation = false;
      continue;
    }

    // Einsatzort-Sektion beginnt
    if (ORT_PATTERN.test(line)) {
      inLocation = true;
      inLocationAdditional = false;
      continue;
    }

    // Zeilen-basiertes Filtern
    if (LINE_PATTERNS.some(p => p.test(line))) {
      inLocation = false;
      inLocationAdditional = false;
      continue;
    }

    if (inLocationAdditional) {
      locationAdditionalLines.push(line);
    } else if (inLocation) {
      locationLines.push(line);
    } else if (!alarmText) {
      // Erste relevante Zeile = Alarmtext
      alarmText = line;
    }
  }

  const location = locationLines.filter(Boolean).join(', ');
  const locationAdditional = locationAdditionalLines.filter(Boolean).join(', ');
  return {
    alarmText: alarmText.trim(),
    location: location.trim(),
    locationAdditional: locationAdditional.trim(),
  };
}

/**
 * Extrahiert einen eventuellen Einsatzortzusatz aus einer einzelnen Adresszeile.
 * Nützlich wenn Zusatz inline steht (z.B. Divera-address-Feld).
 *
 * @param {string} addressLine
 * @returns {{ base: string, zusatz: string }}
 */
function extractOrtZusatz(addressLine) {
  const match = addressLine.match(ORT_INLINE_ZUSATZ_PATTERN);
  if (!match) return { base: addressLine.trim(), zusatz: '' };
  const zusatz = match[0].trim();
  const base   = addressLine.slice(0, addressLine.lastIndexOf(zusatz)).trim();
  return { base, zusatz };
}

/**
 * Baut den finalen Sprechtext aus Alarmtext, Einsatzort und Einsatzortzusatz zusammen.
 * @param {string} rawText
 * @returns {string}
 */
function buildSpeechText(rawText) {
  const { alarmText, location, locationAdditional } = extractAlarmInfo(rawText);

  let speech = '';
  if (alarmText) speech += alarmText + '. ';
  if (location) {
    speech += 'Einsatzort: ' + location;
    if (locationAdditional) {
      speech += ', ' + locationAdditional;
    }
    speech += '.';
  }

  return speech.trim();
}

module.exports = { extractAlarmInfo, extractOrtZusatz, buildSpeechText };
