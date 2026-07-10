const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SESSION_DIRS = [
  path.join(os.homedir(), '.codex'),
  path.join(os.homedir(), '.claude'),
];
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

function normalizeString(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value).trim();
}

function extractAgent(payload, filePath, sourceName) {
  const directKeys = ['agent', 'agent_name', 'assistant', 'model'];
  for (const key of directKeys) {
    const candidate = normalizeString(payload[key]);
    if (candidate) {
      return candidate;
    }
  }

  const nestedKeys = ['metadata', 'session', 'config'];
  for (const containerKey of nestedKeys) {
    const container = payload[containerKey];
    if (!container || typeof container !== 'object') {
      continue;
    }

    for (const key of directKeys) {
      const candidate = normalizeString(container[key]);
      if (candidate) {
        return candidate;
      }
    }
  }

  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('codex')) {
    return 'codex';
  }
  if (lowerPath.includes('claude')) {
    return 'claude';
  }

  return sourceName || 'unknown';
}

function extractFirstJson(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return {};
  }

  if (!content) {
    return {};
  }

  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall back to line-delimited JSON parsing.
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore invalid line and continue.
    }
  }

  return {};
}

function walkFiles(rootDir) {
  const stack = [rootDir];
  const files = [];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function buildSessionRecord(filePath, sourceDir) {
  const payload = extractFirstJson(filePath);
  const stat = fs.statSync(filePath);
  const sourceName = path.basename(sourceDir).replace(/^\./, '');

  return {
    agent: extractAgent(payload, filePath, sourceName),
    source: sourceName || 'unknown',
    title: normalizeString(payload.title) || normalizeString(payload.name) || path.basename(filePath),
    session_id: normalizeString(payload.session_id) || normalizeString(payload.id) || path.parse(filePath).name,
    path: filePath,
    updated_at: new Date(stat.mtimeMs).toISOString(),
  };
}

function discoverSessions(sessionDirs = DEFAULT_SESSION_DIRS) {
  const sessions = [];

  for (const rootDir of sessionDirs) {
    if (!fs.existsSync(rootDir)) {
      continue;
    }

    let rootStat;
    try {
      rootStat = fs.statSync(rootDir);
    } catch {
      continue;
    }

    if (!rootStat.isDirectory()) {
      continue;
    }

    for (const filePath of walkFiles(rootDir)) {
      try {
        const fileStat = fs.statSync(filePath);
        if (fileStat.size > MAX_FILE_SIZE_BYTES) {
          continue;
        }
        sessions.push(buildSessionRecord(filePath, rootDir));
      } catch {
        // Skip unreadable files.
      }
    }
  }

  sessions.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return sessions;
}

function groupByAgent(sessions) {
  const grouped = {};
  for (const session of sessions) {
    if (!grouped[session.agent]) {
      grouped[session.agent] = [];
    }
    grouped[session.agent].push(session);
  }

  return Object.fromEntries(
    Object.entries(grouped).sort(([left], [right]) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    ),
  );
}

module.exports = {
  DEFAULT_SESSION_DIRS,
  discoverSessions,
  groupByAgent,
};
