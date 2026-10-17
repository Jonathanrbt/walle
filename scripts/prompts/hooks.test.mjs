import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sha256 } from './store.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const logPrompt = path.join(repoRoot, '.claude', 'hooks', 'log-prompt.mjs');
const gate = path.join(repoRoot, '.claude', 'hooks', 'gate-commit.mjs');
const sessionStart = path.join(repoRoot, '.claude', 'hooks', 'session-start.mjs');
const secret = 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
}

function initGit(dir, name = 'Ada Lovelace') {
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')}`);
  };
  run(['init']);
  run(['config', 'user.email', 'ada@example.com']);
  run(['config', 'user.name', name]);
  run(['config', 'commit.gpgsign', 'false']);
  run(['config', 'core.autocrlf', 'false']);
}

function runNode(script, { input, cwd, env }) {
  return spawnSync(process.execPath, [script], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('log-prompt redacts, skips slash commands, and fail-opens on bad JSON', () => {
  const dir = tempDir();
  initGit(dir);
  fs.writeFileSync(path.join(dir, '.env'), 'DB_PASSWORD=correct-horse-battery\n');
  const env = { CLAUDE_PROJECT_DIR: dir, USER: 'someone-else' };

  const logged = runNode(logPrompt, {
    cwd: dir,
    env,
    input: JSON.stringify({
      prompt: `my key is ${secret} and correct-horse-battery`,
      session_id: 's',
      cwd: dir,
    }),
  });
  assert.equal(logged.status, 0);
  assert.equal(logged.stdout, '');
  const jsonl = fs.readFileSync(path.join(dir, '.prompts-pending', 'ada-lovelace.jsonl'), 'utf8');
  const row = JSON.parse(jsonl.trim());
  assert.equal(row.session, 's');
  assert.match(row.id, /^[0-9a-f-]{36}$/);
  assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(jsonl.includes(secret), false);
  assert.equal(jsonl.includes('correct-horse-battery'), false);
  assert.match(row.text, /\[REDACTED:sk-\]/);
  assert.match(row.text, /\[REDACTED:DB_PASSWORD\]/);

  const skipped = runNode(logPrompt, {
    cwd: dir,
    env,
    input: JSON.stringify({ prompt: '/review', session_id: 's', cwd: dir }),
  });
  assert.equal(skipped.status, 0);
  assert.equal(skipped.stdout, '');
  const afterSkip = fs.readFileSync(path.join(dir, '.prompts-pending', 'ada-lovelace.jsonl'), 'utf8');
  assert.equal(afterSkip.trim().split('\n').length, 1);

  const empty = runNode(logPrompt, {
    cwd: dir,
    env,
    input: JSON.stringify({ prompt: '   ', session_id: 's', cwd: dir }),
  });
  assert.equal(empty.status, 0);
  assert.equal(fs.readFileSync(path.join(dir, '.prompts-pending', 'ada-lovelace.jsonl'), 'utf8').trim().split('\n').length, 1);

  const bad = runNode(logPrompt, {
    cwd: dir,
    env,
    input: `not json ${secret}`,
  });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
  const errorLog = fs.readFileSync(path.join(dir, '.prompts-pending', 'error.log'), 'utf8');
  assert.match(errorLog, /invalid JSON/);
  assert.equal(errorLog.includes(secret), false);
  const pending = fs.readdirSync(path.join(dir, '.prompts-pending')).map((name) => fs.readFileSync(path.join(dir, '.prompts-pending', name), 'utf8')).join('\n');
  assert.equal(pending.includes(secret), false);
});

test('check-staged and gate-commit block unreviewed prompts and secrets, then allow an approved file', () => {
  const dir = tempDir();
  initGit(dir);
  const rel = 'prompts/ada-lovelace/2026-10-16.md';
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  const clean = '# Prompts — ada-lovelace — 2026-10-16\n\n## 11:00 — prompt abcdef12\n\n```\nShip the donation form\n```\n';
  fs.writeFileSync(path.join(dir, rel), clean);
  spawnSync('git', ['add', rel], { cwd: dir, encoding: 'utf8' });

  const cli = path.join(repoRoot, 'scripts', 'prompts', 'cli.mjs');
  const blocked = spawnSync(process.execPath, [cli, 'check-staged'], { cwd: dir, encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /no approval hash/);
  assert.match(blocked.stdout, /! node scripts\/prompts\/cli\.mjs review/);
  assert.match(blocked.stdout, /Pista:/);

  const gateBlocked = runNode(gate, {
    cwd: dir,
    env: { CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ tool_input: { command: 'git commit -m "add prompts"' }, cwd: dir }),
  });
  assert.equal(gateBlocked.status, 0);
  const denied = JSON.parse(gateBlocked.stdout);
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /must NOT approve or edit prompts/);
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /review/);

  const hash = sha256(fs.readFileSync(path.join(dir, rel)));
  fs.mkdirSync(path.join(dir, '.prompts-pending'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.prompts-pending', 'approved.json'), `${JSON.stringify({ [rel]: hash }, null, 2)}\n`);
  const allowed = spawnSync(process.execPath, [cli, 'check-staged'], { cwd: dir, encoding: 'utf8' });
  assert.equal(allowed.status, 0, allowed.stdout);
  const gateAllowed = runNode(gate, {
    cwd: dir,
    env: { CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ tool_input: { command: 'git -C somewhere commit -m ok' }, cwd: dir }),
  });
  assert.equal(gateAllowed.status, 0);
  assert.equal(gateAllowed.stdout, '');

  const leaked = `${clean}\n${secret}\n`;
  fs.writeFileSync(path.join(dir, rel), leaked);
  spawnSync('git', ['add', rel], { cwd: dir, encoding: 'utf8' });
  const leakedHash = sha256(fs.readFileSync(path.join(dir, rel)));
  fs.writeFileSync(path.join(dir, '.prompts-pending', 'approved.json'), `${JSON.stringify({ [rel]: leakedHash })}\n`);
  const secretBlocked = spawnSync(process.execPath, [cli, 'check-staged'], { cwd: dir, encoding: 'utf8' });
  assert.equal(secretBlocked.status, 1);
  assert.match(secretBlocked.stdout, /contains a secret/);
  assert.equal(secretBlocked.stdout.includes(secret), false);

  fs.writeFileSync(path.join(dir, 'prompts', '.gitkeep'), '');
  fs.writeFileSync(path.join(dir, 'AI_USAGE.md'), '# AI Usage Disclosure\n\nHello.\n');
  spawnSync('git', ['add', 'prompts/.gitkeep', 'AI_USAGE.md'], { cwd: dir, encoding: 'utf8' });
  // The prompts markdown is still staged with a secret; reset it and keep the safe files.
  spawnSync('git', ['reset', 'HEAD', '--', rel], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['reset', '--', rel], { cwd: dir, encoding: 'utf8' });
  const onlyUsage = spawnSync(process.execPath, [cli, 'check-staged'], { cwd: dir, encoding: 'utf8' });
  assert.equal(onlyUsage.status, 0, onlyUsage.stdout);

  const quiet = runNode(gate, {
    cwd: dir,
    env: { CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ tool_input: { command: 'git status' } }),
  });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');

  const piped = runNode(gate, {
    cwd: dir,
    env: { CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ tool_input: { command: 'echo p | node scripts/prompts/cli.mjs review' } }),
  });
  assert.equal(piped.status, 0);
  assert.equal(JSON.parse(piped.stdout).hookSpecificOutput.permissionDecision, 'deny');

  const edited = runNode(gate, {
    cwd: dir,
    env: { CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ tool_input: { command: 'echo {} > .prompts-pending/approved.json' } }),
  });
  assert.equal(JSON.parse(edited.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('session-start sets core.hooksPath and mentions pending prompts', () => {
  const dir = tempDir();
  initGit(dir);
  const pending = path.join(dir, '.prompts-pending');
  fs.mkdirSync(pending, { recursive: true });
  fs.writeFileSync(path.join(pending, 'ada-lovelace.jsonl'), `${JSON.stringify({
    id: '123e4567-e89b-12d3-a456-426614174000',
    ts: '2026-10-16T16:30:00.000Z',
    session: 's',
    text: 'hello',
  })}\n`);

  const started = runNode(sessionStart, {
    cwd: dir,
    env: { CLAUDE_PROJECT_DIR: dir },
    input: '{}',
  });
  assert.equal(started.status, 0);
  assert.match(started.stdout, /^1 prompts sin publicar\. Pide a la persona que ejecute `! node scripts\/prompts\/cli\.mjs review`/);
  const hooksPath = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: dir, encoding: 'utf8' });
  assert.equal(hooksPath.stdout.trim(), '.githooks');

  fs.rmSync(path.join(pending, 'ada-lovelace.jsonl'));
  const quiet = runNode(sessionStart, {
    cwd: dir,
    env: { CLAUDE_PROJECT_DIR: dir },
    input: '{}',
  });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');
});
