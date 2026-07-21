'use strict';

/**
 * Express-Anwendung: Middleware, Routen und globale Fehlerbehandlung.
 */

const express        = require('express');
const path           = require('path');
const { corsMiddleware } = require('./middleware/corsMiddleware');
const requestLogger  = require('./middleware/requestLogger');
const errorHandler   = require('./middleware/errorHandler');
const alarmRoutes    = require('./routes/alarm');
const announceRoutes = require('./routes/announce');
const statusRoutes   = require('./routes/status');
const historyRoutes  = require('./routes/history');
const statsRoutes    = require('./routes/stats');
const healthRoutes   = require('./routes/health');
const voicesRoutes   = require('./routes/voices');
const diveraRoutes   = require('./routes/divera');
const dashboardRoute = require('./routes/dashboard');
const logger         = require('./logging/logger');

const app = express();

// CORS – muss vor allen Routen registriert sein, damit Preflight-Requests
// (OPTIONS) korrekt beantwortet werden.
app.use(corsMiddleware);
app.options('*', corsMiddleware);

// Body-Parser
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Statische Dateien (inkl. public/dashboard/)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Request-Logging
app.use(requestLogger);

// Routen
app.use('/api/alarm',    alarmRoutes);
app.use('/announce',     announceRoutes);
app.use('/api/status',   statusRoutes);
app.use('/api/history',  historyRoutes);
app.use('/api/stats',    statsRoutes);
app.use('/api/health',   healthRoutes);
app.use('/api/voices',   voicesRoutes);
app.use('/api/divera',   diveraRoutes);

// Dashboard – strict: false im Router deckt /dashboard und /dashboard/ ab
app.use('/dashboard', dashboardRoute);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Nicht gefunden', path: req.path });
});

// Globale Fehlerbehandlung
app.use(errorHandler);

module.exports = app;
