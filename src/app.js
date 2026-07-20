'use strict';

/**
 * Express-Anwendung: Middleware, Routen und globale Fehlerbehandlung.
 */

const express        = require('express');
const path           = require('path');
const requestLogger  = require('./middleware/requestLogger');
const errorHandler   = require('./middleware/errorHandler');
const alarmRoutes    = require('./routes/alarm');
const statusRoutes   = require('./routes/status');
const historyRoutes  = require('./routes/history');
const diveraRoutes   = require('./routes/divera');
const dashboardRoute = require('./routes/dashboard');
const logger         = require('./logging/logger');

const app = express();

// Body-Parser
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Statische Dateien (inkl. public/dashboard/)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Request-Logging
app.use(requestLogger);

// Routen
app.use('/api/alarm',   alarmRoutes);
app.use('/api/status',  statusRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/divera',  diveraRoutes);

// Dashboard (v3.1) – strict: false im Router deckt /dashboard und /dashboard/ ab
app.use('/dashboard', dashboardRoute);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Nicht gefunden', path: req.path });
});

// Globale Fehlerbehandlung
app.use(errorHandler);

module.exports = app;
