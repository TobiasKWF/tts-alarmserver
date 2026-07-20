'use strict';

/**
 * Zahlen-zu-Wort-Konvertierung (Deutsch).
 * Wandelt Ziffern im Text in ausgeschriebene deutsche Wörter um,
 * damit Piper/eSpeak sie korrekt ausspricht.
 */

const ONES = ['', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
              'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn',
              'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

/**
 * Wandelt eine nicht-negative Ganzzahl (0–999999) in deutschen Text um.
 * @param {number} n
 * @returns {string}
 */
function numberToWords(n) {
  n = Math.abs(Math.floor(n));
  if (n === 0) return 'null';
  if (n === 1) return 'ein'; // kontextuell – kann auch 'eins' sein

  let result = '';

  if (n >= 1000000) {
    result += numberToWords(Math.floor(n / 1000000)) + ' Million' +
              (Math.floor(n / 1000000) > 1 ? 'en' : '') + ' ';
    n %= 1000000;
  }
  if (n >= 1000) {
    const t = Math.floor(n / 1000);
    result += (t === 1 ? 'tausend' : numberToWords(t) + 'tausend');
    n %= 1000;
  }
  if (n >= 100) {
    result += ONES[Math.floor(n / 100)] + 'hundert';
    n %= 100;
  }
  if (n >= 20) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    result += (o > 0 ? ONES[o] + 'und' : '') + TENS[t];
  } else if (n > 0) {
    result += ONES[n];
  }

  return result.trim();
}

/**
 * Ersetzt alle eigenständigen Zahlen in einem Text durch deutsche Wörter.
 * Zahlen in Stichwort-Kürzeln (B2, TH1 etc.) werden NICHT ersetzt –
 * das erledigt das Feuerwehr-Mapping.
 * @param {string} text
 * @returns {string}
 */
function replaceNumbers(text) {
  // \b(?<!\p{L})  – nur Zahlen, die NICHT direkt an Buchstaben kleben
  // Wir nutzen eine Lookahead/Lookbehind-freie Alternative:
  // Zahl ersetzen, wenn links/rechts keine Buchstaben stehen.
  return text.replace(/(^|(?<=[^A-Za-zÄÖÜäöüß]))(\d+)(?=[^A-Za-zÄÖÜäöüß]|$)/gmu, (match, pre, num) => {
    return (pre || '') + numberToWords(parseInt(num, 10));
  });
}

module.exports = { numberToWords, replaceNumbers };
