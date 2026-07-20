'use strict';

/**
 * Intelligente Textaufteilung für Piper.
 *
 * Schneidet Text NIEMALS mitten in einem Wort oder Satz ab.
 * Aufteilungspriorität:
 *   1. Satzende (.  !  ?)
 *   2. Komma
 *   3. Leerzeichen
 */

/**
 * Teilt einen Text in Chunks auf, die maxLength nicht überschreiten.
 * @param {string} text        - Eingabetext
 * @param {number} maxLength   - Maximale Zeichenanzahl pro Chunk
 * @returns {string[]}         - Array von Chunks
 */
function splitText(text, maxLength) {
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength);

    // 1. Versuch: Satzende (.  !  ?)
    let splitAt = findLastIndex(window, /[.!?]\s/);
    if (splitAt > 0) {
      splitAt += 1; // inkl. Satzzeichen
    } else {
      // 2. Versuch: Komma
      splitAt = findLastIndex(window, /,\s/);
      if (splitAt > 0) {
        splitAt += 1;
      } else {
        // 3. Versuch: Leerzeichen
        splitAt = window.lastIndexOf(' ');
        if (splitAt <= 0) {
          // Kein sinnvoller Trenner gefunden – hart aufteilen (Notfall)
          splitAt = maxLength;
        }
      }
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

/**
 * Hilfsfunktion: letzter Index eines Regex-Matches in einem String.
 * @param {string} str
 * @param {RegExp} re
 * @returns {number} Index oder -1
 */
function findLastIndex(str, re) {
  const matches = [...str.matchAll(new RegExp(re.source, re.flags + (re.flags.includes('g') ? '' : 'g')))];
  if (matches.length === 0) return -1;
  return matches[matches.length - 1].index;
}

module.exports = { splitText };
