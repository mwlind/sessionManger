const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SESSION_DIRS = [
  path.join(os.homedir(), '.codex'),
  path.join(os.homedir(), '.claude'),
];
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TEXT_CHUNK_BYTES = 64 * 1024;
const MAX_TEXT_CHUNK_BYTES = 256 * 1024;

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

function isWithinDirectory(targetPath, baseDir) {
  const absoluteTarget = path.resolve(targetPath);
  const absoluteBase = path.resolve(baseDir);
  return absoluteTarget === absoluteBase || absoluteTarget.startsWith(`${absoluteBase}${path.sep}`);
}

function resolveReadableSessionPath(filePath, sessionDirs = DEFAULT_SESSION_DIRS) {
  const normalizedPath = normalizeString(filePath);
  if (!normalizedPath) {
    return null;
  }

  const resolvedPath = path.resolve(normalizedPath);
  const isAllowed = sessionDirs.some((rootDir) => {
    if (!fs.existsSync(rootDir)) {
      return false;
    }
    return isWithinDirectory(resolvedPath, rootDir);
  });

  if (!isAllowed) {
    return null;
  }

  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  return resolvedPath;
}

function readTextChunk(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const rawOffset = Number(options.offset ?? 0);
  const rawChunkBytes = Number(options.chunkBytes ?? DEFAULT_TEXT_CHUNK_BYTES);
  const chunkBytes = Math.min(MAX_TEXT_CHUNK_BYTES, Math.max(1024, Number.isFinite(rawChunkBytes) ? rawChunkBytes : DEFAULT_TEXT_CHUNK_BYTES));
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);

  const stat = fs.statSync(resolvedPath);
  const totalBytes = stat.size;
  const start = Math.min(offset, totalBytes);
  const remaining = Math.max(0, totalBytes - start);
  const bytesToRead = Math.min(chunkBytes, remaining);

  if (bytesToRead === 0) {
    return {
      content: '',
      offset: start,
      next_offset: start,
      prev_offset: Math.max(0, start - chunkBytes),
      has_more: false,
      total_bytes: totalBytes,
      read_bytes: 0,
    };
  }

  const fileHandle = fs.openSync(resolvedPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const readBytes = fs.readSync(fileHandle, buffer, 0, bytesToRead, start);
    const nextOffset = start + readBytes;

    return {
      content: buffer.subarray(0, readBytes).toString('utf-8'),
      offset: start,
      next_offset: nextOffset,
      prev_offset: Math.max(0, start - chunkBytes),
      has_more: nextOffset < totalBytes,
      total_bytes: totalBytes,
      read_bytes: readBytes,
    };
  } finally {
    fs.closeSync(fileHandle);
  }
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
  DEFAULT_TEXT_CHUNK_BYTES,
  DEFAULT_SESSION_DIRS,
  discoverSessions,
  groupByAgent,
  readTextChunk,
  resolveReadableSessionPath,
};
