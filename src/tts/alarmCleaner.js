'use strict';

/**
 * Alarmtext-Bereinigung.
 *
 * Unterstützte Eingangsformate:
 *   1. Leitstellen-Hash-Format (eine Zeile, #-getrennt):
 *      STICHWORT # Beschreibung # Adresse # HH:MM:SS # EinsatzNr [# Bemerkung]
 *   2. Mehrzeiliges Label-Format:
 *      Erste Zeile = Stichwort
 *      Ort:\n  Adresse
 *      Einsatzortzusatz:\n  Objekt
 *
 * Behalten werden NUR:
 *   - Alarmtext (nur Stichwort – Beschreibung wird verworfen, da das Stichwort
 *     bereits vom speechEnhancer vollständig ausgesprochen wird)
 *   - Einsatzort (Adresse / Koordinaten)
 *   - Einsatzobjekt (Zusatz + Bemerkung)
 *
 * Alles andere (Beschreibung, Datum, Zeit, Einheiten, Fahrzeuge, Status, STORNO …)
 * wird verworfen.
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

const LINE_PATTERNS = [
  /^#{3,}\s*STORNO\s*/i,
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
  /^(?:WF|LF|HLF|TLF|DLK|RW|GW|KTW|RTW|NEF|ELW|MTF|TSF|MLF)\s+\d/i,
  /^Florian\s/i,
  /^Heros\s/i,
  /^Rotkreuz\s/i,
  /^[-=*_]{3,}$/,
];

const ORT_PATTERN            = /^(?:Ort|Einsatzort|Adresse)[:\s]/i;
const ORT_ADDITIONAL_PATTERN = /^(?:Ortzusatz|Einsatzortzusatz|Zusatz|Objekt|Gebäude|Etage|Stockwerk)[:\s]/i;
const ORT_INLINE_ZUSATZ_PATTERN =
  /\b(EG|UG|DG|(?:OG|UG|Stock)\s*\d*|Hinterhaus|Vorderhaus|Seitenflügel|Tor\s*\d+|Aufgang\s*\d+|Eingang\s*\w+|Halle\s*\d*)$/i;

/**
 * Erkennt das Leitstellen-Hash-Format:
 *   STICHWORT # Beschreibung # Adresse # Zeit # Nr [# Bemerkung]
 * Mindestens 2 # auf der ersten Zeile, kein Ort:-Label im Text.
 */
function isHashFormat(text) {
  const line = text.split(/\r?\n/)[0];
  return (line.match(/#/g) || []).length >= 2 && !ORT_PATTERN.test(text);
}

/**
 * Wandelt das Hash-Format in das mehrzeilige Label-Format um.
 *
 * Felder:
 *   [0] Stichwort   → Alarmtext (allein, ohne Beschreibung)
 *   [1] Beschreibung → VERWORFEN (wäre Dopplung zum ausgesprochenen Stichwort)
 *   [2] Adresse     → Ort:
 *   [3] Zeit        → verworfen
 *   [4] EinsatzNr   → verworfen
 *   [5+] Bemerkung  → Einsatzobjekt:
 */
function normalizeHashFormat(text) {
  const firstLine = text.split(/\r?\n/)[0];
  const parts = firstLine.split('#').map(p => p.trim());

  const stichwort = parts[0] || '';
  // parts[1] = Beschreibung – bewusst verworfen
  const adresse   = parts[2] || '';
  // parts[3] = Zeit, parts[4] = EinsatzNr – verworfen
  const bemerkung = parts.slice(5).filter(Boolean).join(', ');

  // Adressfeld: Klammerninhalt (Objekt/Zusatz) herauslösen
  let adresseBase   = adresse;
  let adresseZusatz = bemerkung;

  // Spitze Klammern <Objekt> extrahieren
  const spitzMatch = adresse.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (spitzMatch) {
    adresseBase   = spitzMatch[1].trim();
    adresseZusatz = [spitzMatch[2].trim(), bemerkung].filter(Boolean).join(', ');
  } else {
    // Runde Klammern (Zusatz) extrahieren
    const rundMatch = adresse.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (rundMatch) {
      adresseBase   = rundMatch[1].trim();
      adresseZusatz = [rundMatch[2].trim(), bemerkung].filter(Boolean).join(', ');
    }
  }

  let result = stichwort + '\n';
  if (adresseBase)   result += '\nOrt:\n' + adresseBase;
  if (adresseZusatz) result += '\n\nEinsatzortzusatz:\n' + adresseZusatz;

  return result;
}

function extractAlarmInfo(rawText) {
  const text = isHashFormat(rawText) ? normalizeHashFormat(rawText) : rawText;
  const lines = text.split(/\r?\n/).map(l => l.trim());

  let alarmText               = '';
  let locationLines           = [];
  let locationAdditionalLines = [];
  let inLocation              = false;
  let inLocationAdditional    = false;
  let inRemovedSection        = false;

  for (const line of lines) {
    if (!line) {
      if (inLocation) locationLines.push('');
      continue;
    }

    if (SECTION_PATTERNS.some(p => p.test(line))) {
      inRemovedSection     = true;
      inLocation           = false;
      inLocationAdditional = false;
      continue;
    }

    if (inRemovedSection) {
      if (ORT_PATTERN.test(line)) {
        inRemovedSection = false; inLocation = true; inLocationAdditional = false;
      } else if (ORT_ADDITIONAL_PATTERN.test(line)) {
        inRemovedSection = false; inLocationAdditional = true; inLocation = false;
      }
      continue;
    }

    if (ORT_ADDITIONAL_PATTERN.test(line)) {
      inLocationAdditional = true;
      inLocation           = false;
      const val = line.replace(ORT_ADDITIONAL_PATTERN, '').trim();
      if (val) locationAdditionalLines.push(val);
      continue;
    }

    if (ORT_PATTERN.test(line)) {
      inLocation           = true;
      inLocationAdditional = false;
      continue;
    }

    if (LINE_PATTERNS.some(p => p.test(line))) {
      inLocation = false;
      continue;
    }

    if (inLocationAdditional) {
      locationAdditionalLines.push(line);
    } else if (inLocation) {
      locationLines.push(line);
    } else if (!alarmText) {
      alarmText = line;
    }
  }

  return {
    alarmText:          alarmText.trim(),
    location:           locationLines.filter(Boolean).join(', ').trim(),
    locationAdditional: locationAdditionalLines.filter(Boolean).join(', ').trim(),
  };
}

function extractOrtZusatz(addressLine) {
  const match = addressLine.match(ORT_INLINE_ZUSATZ_PATTERN);
  if (!match) return { base: addressLine.trim(), zusatz: '' };
  const zusatz = match[0].trim();
  const base   = addressLine.slice(0, addressLine.lastIndexOf(zusatz)).trim();
  return { base, zusatz };
}

function deduplicateRoadRefs(text) {
  const seen = new Set();
  return text.replace(/\b([ABLKSE]\d{1,4})\b/g, (match) => {
    if (seen.has(match)) return '';
    seen.add(match);
    return match;
  }).replace(/\s{2,}/g, ' ').trim();
}

function buildSpeechText(rawText) {
  const { alarmText, location, locationAdditional } = extractAlarmInfo(rawText);
  const locationClean = deduplicateRoadRefs(location);

  let speech = '';
  if (alarmText)          speech += alarmText + '. ';
  if (locationClean)      speech += 'Einsatzort: ' + locationClean + '.';
  if (locationAdditional) speech += ' Einsatzobjekt: ' + locationAdditional + '.';

  return speech.trim();
}

module.exports = {
  extractAlarmInfo,
  extractOrtZusatz,
  deduplicateRoadRefs,
  buildSpeechText,
  isHashFormat,
  normalizeHashFormat,
};
