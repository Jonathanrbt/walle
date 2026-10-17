import { spawnSync } from 'node:child_process';
import { readPending } from '../../scripts/prompts/store.mjs';
import { currentUser } from '../../scripts/prompts/user.mjs';

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function ensureHooksPath(cwd) {
  try {
    const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, encoding: 'utf8' });
    const value = current.status === 0 ? current.stdout.trim() : '';
    if (value !== '.githooks') {
      spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd, encoding: 'utf8' });
    }
  } catch {
    // Ignore missing git or a non-repository directory.
  }
}

async function drainStdin() {
  if (process.stdin.isTTY) return;
  try {
    for await (const chunk of process.stdin) {
      void chunk;
    }
  } catch {
    // Session context is optional.
  }
}

async function main() {
  await drainStdin();
  const cwd = projectDir();
  ensureHooksPath(cwd);
  let pending = 0;
  try {
    pending = readPending(cwd, currentUser(cwd)).length;
  } catch {
    pending = 0;
  }
  if (pending > 0) {
    process.stdout.write(
      `${pending} prompts sin publicar. Pide a la persona que ejecute \`! node scripts/prompts/cli.mjs review\` antes del cierre de la entrega (sáb 11:00).\n`,
    );
  }
}

main().then(() => process.exit(0), () => process.exit(0));
