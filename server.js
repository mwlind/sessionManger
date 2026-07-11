const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  DEFAULT_SESSION_DIRS,
  discoverSessions,
  groupByAgent,
  readTextChunk,
  resolveReadableSessionPath,
} = require('./sessionService');

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
let cachedSessions = [];
let cachedSessionPaths = new Set();

function refreshSessionCache() {
  cachedSessions = discoverSessions();
  cachedGroupedSessions = groupByAgent(cachedSessions);
  cachedSessionPaths = new Set(cachedSessions.map((session) => session.path));
}

refreshSessionCache();
setInterval(refreshSessionCache, CACHE_REFRESH_INTERVAL_MS).unref();

app.get('/api/sessions', sessionApiRateLimit, (_req, res) => {
  res.json({ agents: cachedGroupedSessions });
});

app.get('/api/session-content', sessionApiRateLimit, (req, res) => {
  const requestedPath = String(req.query.path || '');
  const resolvedPath = resolveReadableSessionPath(requestedPath, DEFAULT_SESSION_DIRS);
  const isKnownSessionFile = resolvedPath ? cachedSessionPaths.has(resolvedPath) : false;

  if (!resolvedPath || !isKnownSessionFile) {
    res.status(404).json({ error: 'Session file not found' });
    return;
  }

  try {
    const offset = Number(req.query.offset || 0);
    const chunkBytes = req.query.chunk_bytes ? Number(req.query.chunk_bytes) : undefined;
    const chunk = readTextChunk(resolvedPath, { offset, chunkBytes });
    res.json({
      path: resolvedPath,
      ...chunk,
    });
  } catch {
    res.status(500).json({ error: 'Failed to read file content' });
  }
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
