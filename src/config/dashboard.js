'use strict';

/**
 * @file config/dashboard.js
 * @description Konfigurationsoptionen für das Dashboard (v3.1).
 */

module.exports = {
  // WebSocket Auto-Reconnect (exponentieller Backoff, Frontend)
  wsReconnect: {
    initialDelayMs: 1000,
    maxDelayMs:     30_000,
    factor:         2,
  },

  // In-Memory-Limits
  historyLimit: 50,
  errorLimit:   20,
};
