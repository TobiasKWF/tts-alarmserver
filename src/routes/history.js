'use strict';

/**
 * Route: GET /api/history[?limit=N]
 * Gibt die letzten N Alarmierungen zurück.
 */

const express = require('express');
const router = express.Router();
const historyService = require('../services/historyService');

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  res.json(historyService.getLast(limit));
});

module.exports = router;
