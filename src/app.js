'use strict';

const express = require('express');
const path = require('path');
const { helmetMiddleware } = require('./middleware/helmetMiddleware');
const { corsMiddleware } = require('./middleware/corsMiddleware');
const { sanitize } = require('./middleware/sanitize');
const { globalLimiter, announceLimiter, diveraLimiter } = require('./middleware/rateLimiter');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const alarmRoutes = require('./routes/alarm');
const announceRoutes = require('./routes/announce');
const statusRoutes = require('./routes/status');
const historyRoutes = require('./routes/history');
const statsRoutes = require('./routes/stats');
const healthRoutes = require('./routes/health');
const voicesRoutes = require('./routes/voices');
const diveraRoutes = require('./routes/divera');
const dashboardRoute = require('./routes/dashboard');
const alarmKeywordsRoutes = require('./routes/alarmKeywords');

const app = express();
app.set('trust proxy', 1);
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.options('*', corsMiddleware);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(sanitize);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(requestLogger);

app.use('/api/alarm', globalLimiter);
app.use('/announce', globalLimiter, announceLimiter);
app.use('/api/divera', globalLimiter, diveraLimiter);
app.use('/api/voices', globalLimiter);
app.use('/api/alarm-keywords', globalLimiter);

app.use('/api/alarm', alarmRoutes);
app.use('/announce', announceRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/voices', voicesRoutes);
app.use('/api/divera', diveraRoutes);
app.use('/api/alarm-keywords', alarmKeywordsRoutes);
app.use('/dashboard', dashboardRoute);

app.use((req, res) => {
  res.status(404).json({ error: 'Nicht gefunden', path: req.path });
});
app.use(errorHandler);
module.exports = app;
