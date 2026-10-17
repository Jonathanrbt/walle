import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { redact } from '../../scripts/prompts/redact.mjs';
import { pendingPath } from '../../scripts/prompts/store.mjs';
import { currentUser } from '../../scripts/prompts/user.mjs';

function projectDir(cwd) {
  return process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
}

function logError(dir, message) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(message || 'log-prompt failed').replace(/[\r\n]+/g, ' ').slice(0, 500);
    fs.appendFileSync(path.join(dir, 'error.log'), `${new Date().toISOString()} ${safe}\n`);
  } catch {
    // Fail open: never block the prompt.
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let project = projectDir();
  try {
    const raw = await readStdin();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      logError(path.join(project, '.prompts-pending'), 'invalid JSON on stdin');
      return;
    }
    project = projectDir(typeof payload.cwd === 'string' ? payload.cwd : undefined);
    const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
    if (!prompt.trim() || prompt.startsWith('/') || /^\s*<(task-notification|system-reminder)/.test(prompt)) return;
    const text = redact(prompt, { cwd: project });
    const file = pendingPath(project, currentUser(project));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      id: randomUUID(),
      ts: new Date().toISOString(),
      session: typeof payload.session_id === 'string' ? payload.session_id : '',
      text,
    }).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    fs.appendFileSync(file, `${line}\n`);
  } catch (error) {
    logError(path.join(project, '.prompts-pending'), error instanceof Error ? error.message : 'log-prompt failed');
  }
}

main().then(() => process.exit(0), () => process.exit(0));
