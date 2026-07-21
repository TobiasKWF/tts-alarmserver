'use strict';

/**
 * Alarmtext-Bereinigung.
 *
 * Unterstützte Eingangsformate:
 *   1. Leitstellen-Hash-Format (eine Zeile, #-getrennt):
 *      STICHWORT # Beschreibung # Adresse # HH:MM:SS # EinsatzNr [# Bemerkung]
 *   2. Mehrzeiliges Label-Format:
 *      Erste Zeile = Stichwort, Ort:\n Adresse, Einsatzortzusatz:\n Objekt
 *
 * Logik für Beschreibung (Feld [1]):
 *   - Generische Stichwort-Codes (H0, H1, H2, H3, H VU-1 ohne eigene VP-Info
 *     usw.) erhalten die Beschreibung angehängt, damit die Durchsage
 *     vollständig ist.
 *   - Alle anderen Codes (B x, BMA, VU, H1Y, HOEL …) sprechen sich durch
 *     den speechEnhancer selbst vollständig aus → Beschreibung wird verworfen
 *     um Dopplung zu vermeiden.
 *
 * Bemerkung (Feld [5+]):
 *   - Immer vollständig übernehmen (Einsatzinfos bleiben erhalten).
 *   - Wenn Bemerkung mit derselben Information wie die Beschreibung beginnt,
 *     wird der redundante Präfix entfernt.
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
 * Codes deren eingebettetes Stichwort so generisch ist, dass die Beschreibung
 * aus Feld [1] als Zusatzinfo mit in den Alarmtext übernommen wird.
 * Alle anderen Codes sprechen sich durch den speechEnhancer selbst vollständig
 * aus (z.B. B2, BMA, H1Y, HOEL1, VU1 …) – Beschreibung dort verwerfen.
 */
const GENERIC_CODES = /^(H\s*0|H\s*1|H\s*2|H\s*3|H\s*VU|VU)\b/i;

/**
 * Erkennt das Leitstellen-Hash-Format.
 * Mind. 2 # auf der ersten Zeile, kein Ort:-Label im gesamten Text.
 */
function isHashFormat(text) {
  const line = text.split(/\r?\n/)[0];
  return (line.match(/#/g) || []).length >= 2 && !ORT_PATTERN.test(text);
}

/**
 * Entfernt redundante Präfixe aus der Bemerkung wenn diese mit derselben
 * Information wie die Beschreibung beginnt.
 * Beispiel:
 *   beschreibung = "Wasser im Keller"
 *   bemerkung    = "Wasser im Keller Schützenhaus"
 *   → Ergebnis    = "Schützenhaus"
 */
function deduplicateBemerkung(beschreibung, bemerkung) {
  if (!beschreibung || !bemerkung) return bemerkung;
  const norm = s => s.toLowerCase().replace(/[\s,;]+/g, ' ').trim();
  const bDesc = norm(beschreibung);
  const bBem  = norm(bemerkung);
  if (bBem.startsWith(bDesc)) {
    const rest = bemerkung.slice(beschreibung.length).replace(/^[\s,;]+/, '').trim();
    return rest || '';
  }
  return bemerkung;
}

/**
 * Wandelt das Hash-Format in das mehrzeilige Label-Format um.
 *
 * Felder:
 *   [0] Stichwort    → Alarmtext
 *   [1] Beschreibung → nur bei generischen Codes an Stichwort anhängen,
 *                      sonst verworfen (Dopplung)
 *   [2] Adresse      → Ort:
 *   [3] Zeit         → verworfen
 *   [4] EinsatzNr    → verworfen
 *   [5+] Bemerkung   → Einsatzobjekt: (vollständig, Dopplung zu [1] entfernt)
 */
function normalizeHashFormat(text) {
  const firstLine = text.split(/\r?\n/)[0];
  const parts = firstLine.split('#').map(p => p.trim());

  const stichwort    = parts[0] || '';
  const beschreibung = parts[1] || '';
  const adresse      = parts[2] || '';
  // parts[3] = Zeit, parts[4] = EinsatzNr – verworfen
  const bemerkungRaw = parts.slice(5).filter(Boolean).join(', ');

  // Beschreibung nur bei generischen Codes an Stichwort hängen
  const useDescription = GENERIC_CODES.test(stichwort) && beschreibung;
  const alarmLine = useDescription
    ? `${stichwort} ${beschreibung}`
    : stichwort;

  // Bemerkung: redundante Beschreibungs-Info entfernen
  const bemerkung = deduplicateBemerkung(
    useDescription ? '' : beschreibung, // bei generischen Codes schon im alarmLine
    bemerkungRaw
  );

  // Adressfeld: Klammerninhalt herauslösen
  let adresseBase   = adresse;
  let adresseZusatz = bemerkung;

  // Spitze Klammern <Objekt>
  const spitzMatch = adresse.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (spitzMatch) {
    adresseBase   = spitzMatch[1].trim();
    adresseZusatz = [spitzMatch[2].trim(), bemerkung].filter(Boolean).join(', ');
  } else {
    // Runde Klammern (Zusatz)
    const rundMatch = adresse.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (rundMatch) {
      adresseBase   = rundMatch[1].trim();
      adresseZusatz = [rundMatch[2].trim(), bemerkung].filter(Boolean).join(', ');
    }
  }

  let result = alarmLine + '\n';
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
