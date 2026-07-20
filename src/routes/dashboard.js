'use strict';

/**
 * @file routes/dashboard.js
 * @description GET /dashboard und /dashboard/ – liefert die Dashboard-HTML-Shell (v3.1).
 *
 * Fix: express.Router mit strict: false (Standard) plus explizite Route fuer
 * beide Varianten ("/" und ""), damit Trailing-Slash-Anfragen (/dashboard/)
 * nicht im 404-Handler landen.
 */

const path   = require('path');
const router = require('express').Router({ strict: false });

const HTML = path.resolve(__dirname, '../../public/dashboard/index.html');

// Matcht sowohl /dashboard als auch /dashboard/
router.get(['/', ''], (_req, res) => {
  res.sendFile(HTML);
});

module.exports = router;
