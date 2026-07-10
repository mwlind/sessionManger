const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { discoverSessions, groupByAgent } = require('./sessionService');

const app = express();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const frontendDistDir = path.join(__dirname, 'frontend', 'dist');
const sessionApiRateLimit = rateLimit({
  windowMs: 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});
const CACHE_REFRESH_INTERVAL_MS = 5000;
let cachedGroupedSessions = {};

function refreshSessionCache() {
  cachedGroupedSessions = groupByAgent(discoverSessions());
}

refreshSessionCache();
setInterval(refreshSessionCache, CACHE_REFRESH_INTERVAL_MS).unref();

app.get('/api/sessions', sessionApiRateLimit, (_req, res) => {
  res.json({ agents: cachedGroupedSessions });
});

if (fs.existsSync(frontendDistDir)) {
  const indexHtml = fs.readFileSync(path.join(frontendDistDir, 'index.html'), 'utf-8');
  app.use(express.static(frontendDistDir));

  app.use((_req, res) => {
    res.type('html').send(indexHtml);
  });
} else {
  app.get('/', (_req, res) => {
    res.status(200).send(
      'Frontend dist not found. Run "npm --prefix frontend run build" and restart server, or run "npm --prefix frontend run dev" for UI development.',
    );
  });
}

app.listen(port, host, () => {
  console.log(`Session Manager API running at http://${host}:${port}`);
});
