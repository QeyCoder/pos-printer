const express = require('express');
const helmet = require('helmet');
const printRoutes = require('./routes/print');

function createServer() {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────────
  app.use(helmet());

  // ── Body parsing ────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));

  // ── Request logging (lightweight) ───────────────────────────────────────────
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
    });
    next();
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.use('/', printRoutes);

  // ── 404 handler ─────────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Global error handler ─────────────────────────────────────────────────────
  app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  });

  return app;
}

module.exports = { createServer };
