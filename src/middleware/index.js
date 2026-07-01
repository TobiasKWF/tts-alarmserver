'use strict';

/**
 * @file middleware/index.js
 * @description Barrel-Export aller Middleware-Module.
 *
 * Ermöglicht zentralen Import in app.js:
 *   const { requestId, requestLogger, errorHandler } = require('./middleware');
 */

const { requestId }        = require('./requestId');
const { requestLogger }    = require('./requestLogger');
const { errorHandler }     = require('./errorHandler');
const { notFoundHandler }  = require('./notFoundHandler');
const { apiKeyAuth }       = require('./apiKeyAuth');
const { globalLimiter, announceLimiter, diveraLimiter } = require('./rateLimiter');
const { corsMiddleware }   = require('./corsMiddleware');
const { sanitize }         = require('./sanitize');

module.exports = {
  requestId,
  requestLogger,
  errorHandler,
  notFoundHandler,
  apiKeyAuth,
  globalLimiter,
  announceLimiter,
  diveraLimiter,
  corsMiddleware,
  sanitize,
};
