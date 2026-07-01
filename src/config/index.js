'use strict';

/**
 * @file config/index.js
 * @description Backward-Compatibility-Shim.
 *
 * Alle Services wurden auf src/config.js umgestellt.
 * Dieses Modul leitet nur noch weiter, damit ältere Importe
 * (require('./config') aus einem Unterordner) nicht brechen.
 */

module.exports = require('../config');
