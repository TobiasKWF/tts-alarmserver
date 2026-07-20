'use strict';

/**
 * @file routes/dashboard.js
 * @description GET /dashboard – liefert die Dashboard-HTML-Shell (v3.1).
 */

const path   = require('path');
const router = require('express').Router();

// HTML-Shell ausliefern
router.get('/', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../../public/dashboard/index.html'));
});

module.exports = router;
