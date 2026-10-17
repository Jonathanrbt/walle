import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hookDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(hookDir, '..', '..', 'scripts', 'prompts', 'cli.mjs');

const COMMIT_RE = /\bgit\s+(-\S+\s+)*commit\b/;
const AGENT_NOTE = 'Ask the user to run `! node scripts/prompts/cli.mjs review`. The agent must NOT approve or edit prompts itself.';

function projectDir(cwd) {
  return process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

function isPipedReview(command) {
  if (!/\bcli\.mjs\b/.test(command) || !/\breview\b/.test(command)) return false;
  if (/\breview\s+--list\b/.test(command)) return false;
  const stripped = command.replace(/'[^']*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""');
  const at = stripped.search(/\bcli\.mjs\b/);
  const before = at >= 0 ? stripped.slice(0, at) : '';
  if (/\|/.test(before)) return true;
  if (/<<</.test(stripped) || /<</.test(stripped)) return true;
  if (/(^|[^<])<\s*\S/.test(stripped)) return true;
  return false;
}

function editsApproved(command) {
  if (!/\.prompts-pending[\\/]approved\.json/.test(command)) return false;
  const readOnly = /^\s*(?:cat|head|tail|less|more|jq|bat)\b/.test(command)
    && !/[>|]/.test(command)
    && !/\btee\b/.test(command);
  if (readOnly) return false;
  return /[>]|\btee\b|\bsed\b|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\bdd\b|\bvim?\b|\bnano\b|\bemacs\b|\bed\b|\bnode\b|\bpython3?\b|\bperl\b/.test(command);
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) return;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const command = payload?.tool_input?.command;
    if (typeof command !== 'string') return;
    if (isPipedReview(command)) {
      deny(`Blocked a non-interactive prompt review. ${AGENT_NOTE}`);
      return;
    }
    if (editsApproved(command)) {
      deny(`Blocked an edit to .prompts-pending/approved.json. Approval is a human action. ${AGENT_NOTE}`);
      return;
    }
    if (!COMMIT_RE.test(command)) return;
    const project = projectDir(typeof payload.cwd === 'string' ? payload.cwd : undefined);
    const result = spawnSync(process.execPath, [cli, 'check-staged'], {
      cwd: project,
      encoding: 'utf8',
    });
    if (result.status === 0 && !result.error) return;
    const detail = `${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`.trim()
      || 'check-staged failed';
    deny(`${detail}\n${AGENT_NOTE}`);
  } catch {
    try {
      deny(`Commit check failed. ${AGENT_NOTE}`);
    } catch {
      // Exit 0 either way. A deny above is the fail-closed path.
    }
  }
}

main().then(() => process.exit(0), () => process.exit(0));
