const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { discoverSessions, groupByAgent } = require('../sessionService');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-manager-'));
}

test('discoverSessions reads metadata from JSON', () => {
  const tempRoot = makeTempDir();
  const codexRoot = path.join(tempRoot, '.codex');
  fs.mkdirSync(codexRoot, { recursive: true });

  fs.writeFileSync(
    path.join(codexRoot, 'session.json'),
    JSON.stringify({ session_id: 's-1', title: 'Demo', agent_name: 'codex-agent' }),
    'utf-8',
  );

  const sessions = discoverSessions([codexRoot]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session_id, 's-1');
  assert.equal(sessions[0].title, 'Demo');
  assert.equal(sessions[0].agent, 'codex-agent');
  assert.equal(sessions[0].source, 'codex');
});

test('discoverSessions supports line-delimited JSON fallback', () => {
  const tempRoot = makeTempDir();
  const claudeRoot = path.join(tempRoot, '.claude');
  fs.mkdirSync(claudeRoot, { recursive: true });

  fs.writeFileSync(
    path.join(claudeRoot, 'events.log'),
    ['not-json', JSON.stringify({ session_id: 's-2', title: 'From lines', agent: 'claude' })].join('\n'),
    'utf-8',
  );

  const sessions = discoverSessions([claudeRoot]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session_id, 's-2');
  assert.equal(sessions[0].agent, 'claude');
});

test('groupByAgent sorts agent keys', () => {
  const grouped = groupByAgent([
    { agent: 'zeta', session_id: '1' },
    { agent: 'Alpha', session_id: '2' },
  ]);

  assert.deepEqual(Object.keys(grouped), ['Alpha', 'zeta']);
});
