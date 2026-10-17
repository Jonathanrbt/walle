import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildUsage, formatStamp } from './cli.mjs';
import { sha256 } from './store.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = path.join(repoRoot, 'scripts', 'prompts', 'cli.mjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
}

function initGit(dir) {
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || args.join(' '));
  };
  run(['init']);
  run(['config', 'user.email', 'ada@example.com']);
  run(['config', 'user.name', 'Ada Lovelace']);
  run(['config', 'commit.gpgsign', 'false']);
  run(['config', 'core.autocrlf', 'false']);
}

test('review publishes a pending prompt and records its sha256', () => {
  const dir = tempDir();
  initGit(dir);
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const ts = '2026-10-16T16:30:00.000Z';
  const text = 'Ship the donation form.\nIt contains ``` backticks.';
  fs.mkdirSync(path.join(dir, '.prompts-pending'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.prompts-pending', 'ada-lovelace.jsonl'),
    `${JSON.stringify({ id, ts, session: 's', text })}\n`,
  );

  const result = spawnSync(process.execPath, [cli, 'review'], {
    cwd: dir,
    input: 'p\n',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.prompts-pending', 'ada-lovelace.jsonl')), false);

  const stamp = formatStamp(ts);
  const rel = `prompts/ada-lovelace/${stamp.date}.md`;
  const body = fs.readFileSync(path.join(dir, rel), 'utf8');
  assert.match(body, new RegExp(`^# Prompts — ada-lovelace — ${stamp.date}`));
  assert.match(body, new RegExp(`## ${stamp.time} — prompt 123e4567`));
  assert.match(body, /````\nShip the donation form\.\nIt contains ``` backticks\.\n````/);
  const approved = JSON.parse(fs.readFileSync(path.join(dir, '.prompts-pending', 'approved.json'), 'utf8'));
  assert.equal(approved[rel], sha256(fs.readFileSync(path.join(dir, rel))));

  const listed = spawnSync(process.execPath, [cli, 'review', '--list'], { cwd: dir, encoding: 'utf8' });
  assert.match(listed.stdout, /^0 pending prompt\(s\) for ada-lovelace/);
  const status = spawnSync(process.execPath, [cli, 'status'], { cwd: dir, encoding: 'utf8' });
  assert.match(status.stdout, /pending: 0/);
});

test('build-usage merges fragments and prompt links, and a second run is identical', () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'ai-usage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai-usage', 'README.md'), 'skip me\n');
  fs.writeFileSync(path.join(dir, 'ai-usage', 'TEMPLATE.md'), 'skip me too\n');
  fs.writeFileSync(path.join(dir, 'ai-usage', 'zoe.md'), '### Tools Used\n\n- Claude\n');
  fs.writeFileSync(path.join(dir, 'ai-usage', 'ada.md'), '### Tools Used\n\n- Cursor\n');
  fs.mkdirSync(path.join(dir, 'prompts', 'ada'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'prompts', '.gitkeep'), '');
  fs.writeFileSync(path.join(dir, 'prompts', 'ada', '2026-10-16.md'), '# Prompts\n');

  const first = buildUsage(dir);
  const second = buildUsage(dir);
  assert.equal(second, first);
  assert.match(first, /^# AI Usage Disclosure\n\n## Tools Used\n\nSecrets are replaced with `\[REDACTED:\.\.\.\]` markers/);
  assert.ok(first.indexOf('## ada\n') < first.indexOf('## zoe\n'));
  assert.match(first, /## Prompt Log\n\n- \[prompts\/ada\/2026-10-16\.md\]\(prompts\/ada\/2026-10-16\.md\)/);
  assert.equal(first.includes('skip me'), false);
});
