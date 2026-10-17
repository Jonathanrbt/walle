import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { redact, scan } from './redact.mjs';
import { readApproved, readPending, recordApproval, sha256, writePending } from './store.mjs';
import { currentUser } from './user.mjs';

const HELP = `Usage: node scripts/prompts/cli.mjs <command>

Commands:
  review           Review pending prompts ([p]ublish, [e]dit, [s]kip, [d]rop, [q]uit)
  review --list    Print the pending count and a one-line preview of each prompt
  status           Print the pending count and whether staged prompt files are approved
  check-staged     Exit 1 when staged prompts are unapproved or staged AI files contain secrets
  build-usage      Merge ai-usage/*.md into AI_USAGE.md
  --help           Show this help
`;

const REVIEW_HINT = '! node scripts/prompts/cli.mjs review';

export function formatStamp(iso) {
  const date = new Date(iso);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
    time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
  };
}

export function fenceFor(text) {
  const runs = String(text).match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const body = String(text).endsWith('\n') ? String(text) : `${text}\n`;
  return `${fence}\n${body}${fence}\n`;
}

function red(text) {
  return `\x1b[31m${text}\x1b[0m`;
}

function preview(text) {
  return String(text).replace(/\s+/g, ' ').slice(0, 80);
}

function gitOutput(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function stagedPaths(cwd) {
  const raw = gitOutput(cwd, ['diff', '--cached', '--name-only', '-z']);
  return raw.toString('utf8').split('\0').filter(Boolean);
}

function stagedBytes(cwd, file) {
  return gitOutput(cwd, ['show', `:${file}`]);
}

function isGitkeep(file) {
  return path.posix.basename(file) === '.gitkeep';
}

function isPromptFile(file) {
  return file.startsWith('prompts/') && !isGitkeep(file);
}

function isUsageFile(file) {
  return file === 'AI_USAGE.md' || file.startsWith('ai-usage/');
}

/**
 * @param {string} cwd
 * @returns {{ ok: boolean, message: string, problems: string[] }}
 */
export function checkStaged(cwd = process.cwd()) {
  let files;
  try {
    files = stagedPaths(cwd);
  } catch (error) {
    const detail = String(error.stderr || error.message || 'git failed');
    if (/not a git repository/i.test(detail)) {
      return { ok: true, message: '', problems: [] };
    }
    return {
      ok: false,
      problems: [`Could not read staged files: ${detail.split('\n')[0]}`],
      message: '',
    };
  }

  const approved = readApproved(cwd);
  const problems = [];
  for (const file of files) {
    if (!isPromptFile(file) && !isUsageFile(file)) continue;
    let bytes;
    try {
      bytes = stagedBytes(cwd, file);
    } catch (error) {
      problems.push(`${file} could not be read from the index (${String(error.message).split('\n')[0]})`);
      continue;
    }
    const text = bytes.toString('utf8');
    const findings = scan(text, { cwd });
    if (findings.length) {
      const reasons = [...new Set(findings.map((finding) => finding.reason))].join(', ');
      problems.push(`${file} contains a secret (${reasons})`);
    }
    if (isPromptFile(file)) {
      const hash = sha256(bytes);
      if (approved[file] !== hash) {
        problems.push(
          approved[file]
            ? `${file} is not an approved version (sha256 mismatch)`
            : `${file} has no approval hash in .prompts-pending/approved.json`,
        );
      }
    }
  }

  if (!problems.length) return { ok: true, message: '', problems };
  const message = [
    'Commit blocked: staged AI usage files are not approved or contain secrets.',
    ...problems.map((problem) => `- ${problem}`),
    `Run ${REVIEW_HINT}`,
    'Pista: ejecuta ! node scripts/prompts/cli.mjs review para publicar o descartar los prompts antes de hacer commit.',
  ].join('\n');
  return { ok: false, message, problems };
}

export function publishPrompt(cwd, user, item) {
  const { date, time } = formatStamp(item.ts);
  const rel = `prompts/${user}/${date}.md`;
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  let body = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : `# Prompts — ${user} — ${date}\n\n`;
  if (!body.endsWith('\n')) body += '\n';
  if (!body.endsWith('\n\n')) body += '\n';
  const short = String(item.id).replace(/-/g, '').slice(0, 8);
  body += `## ${time} — prompt ${short}\n\n${fenceFor(item.text)}\n`;
  const bytes = Buffer.from(body, 'utf8');
  fs.writeFileSync(abs, bytes);
  recordApproval(cwd, rel, sha256(bytes));
  return rel;
}

function listPromptFiles(cwd) {
  const root = path.join(cwd, 'prompts');
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.gitkeep') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) found.push(path.relative(cwd, abs).split(path.sep).join('/'));
    }
  };
  walk(root);
  found.sort((a, b) => a.localeCompare(b, 'en'));
  return found;
}

export function buildUsage(cwd = process.cwd()) {
  const dir = path.join(cwd, 'ai-usage');
  let names = [];
  if (fs.existsSync(dir)) {
    names = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.md') && name !== 'README.md' && name !== 'TEMPLATE.md')
      .sort((a, b) => a.localeCompare(b, 'en'));
  }
  let out = '# AI Usage Disclosure\n\n';
  out += '## Tools Used\n\n';
  out += 'Secrets are replaced with `[REDACTED:...]` markers before they are written to this repository. Each person lists the tools they used in the section below.\n\n';
  for (const name of names) {
    const user = name.slice(0, -3);
    const body = fs.readFileSync(path.join(dir, name), 'utf8').trim();
    out += `## ${user}\n\n${body}\n\n`;
  }
  out += '## Prompt Log\n\n';
  const prompts = listPromptFiles(cwd);
  out += prompts.length
    ? `${prompts.map((file) => `- [${file}](${file})`).join('\n')}\n`
    : 'No published prompts yet.\n';
  fs.writeFileSync(path.join(cwd, 'AI_USAGE.md'), out);
  return out;
}

function relevantStaged(cwd) {
  try {
    return stagedPaths(cwd).filter((file) => isPromptFile(file) || isUsageFile(file));
  } catch {
    return null;
  }
}

export function statusReport(cwd = process.cwd()) {
  const user = currentUser(cwd);
  const pending = readPending(cwd, user);
  const lines = [`pending: ${pending.length} (${user})`];
  const staged = relevantStaged(cwd);
  if (staged === null) {
    lines.push('staged: not a git repository');
    return lines.join('\n');
  }
  if (!staged.length) {
    lines.push('staged: no prompts or AI usage files');
    return lines.join('\n');
  }
  const approved = readApproved(cwd);
  lines.push('staged:');
  for (const file of staged) {
    if (isUsageFile(file)) {
      lines.push(`- ${file}: secret scan only (no approval hash)`);
      continue;
    }
    let bytes;
    try {
      bytes = stagedBytes(cwd, file);
    } catch {
      lines.push(`- ${file}: unreadable`);
      continue;
    }
    lines.push(`- ${file}: ${approved[file] === sha256(bytes) ? 'approved' : 'NOT approved'}`);
  }
  return lines.join('\n');
}

async function editText(text, id) {
  const tmp = path.join(os.tmpdir(), `prompt-edit-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.txt`);
  fs.writeFileSync(tmp, text, 'utf8');
  const requested = process.env.VISUAL || process.env.EDITOR || '';
  const candidates = requested ? [requested] : ['nano', 'vi'];
  let launched = false;
  let lastError = 'editor failed to start';
  for (const bin of candidates) {
    const parts = bin.split(/\s+/).filter(Boolean);
    const result = spawnSync(parts[0], [...parts.slice(1), tmp], { stdio: 'inherit' });
    if (result.error) {
      lastError = result.error.message;
      if (requested) break;
      continue;
    }
    launched = true;
    if (result.status !== 0) {
      lastError = `${parts[0]} exited ${result.status}`;
      launched = false;
    }
    break;
  }
  let next = text;
  try {
    next = fs.readFileSync(tmp, 'utf8');
  } catch {
    launched = false;
    lastError = 'could not read the edited prompt';
  }
  fs.rmSync(tmp, { force: true });
  if (!launched) {
    const error = new Error(lastError);
    throw error;
  }
  return next;
}

function showPrompt(stdout, item, index, total, cwd) {
  const findings = scan(item.text, { cwd });
  stdout.write(`\n[${index + 1}/${total}] ${item.ts || 'unknown time'}\n`);
  stdout.write(`${item.text}\n`);
  if (findings.length) {
    for (const finding of findings) {
      stdout.write(`${red(`secret [${finding.reason}] at character ${finding.start}`)}\n`);
    }
  }
}

async function reviewInteractive(cwd, stdout, stdin) {
  const user = currentUser(cwd);
  const items = readPending(cwd, user);
  if (!items.length) {
    stdout.write(`No pending prompts for ${user}.\n`);
    return 0;
  }
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin.isTTY),
  });
  const kept = [];
  try {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      showPrompt(stdout, item, index, items.length, cwd);
      const answer = (await rl.question('[p]ublish  [e]dit  [s]kip (keep pending)  [d]rop (delete)  [q]uit\n> '))
        .trim()
        .toLowerCase();
      if (answer === 'q' || answer === 'quit') {
        kept.push(item, ...items.slice(index + 1));
        break;
      }
      if (answer === 's' || answer === 'skip') {
        kept.push(item);
        continue;
      }
      if (answer === 'd' || answer === 'drop') continue;
      if (answer === 'e' || answer === 'edit') {
        try {
          item.text = await editText(item.text, item.id);
        } catch (error) {
          stdout.write(`Edit cancelled: ${error.message}\n`);
          kept.push(item);
          continue;
        }
        const findings = scan(item.text, { cwd });
        if (findings.length) {
          const reasons = [...new Set(findings.map((finding) => finding.reason))].join(', ');
          stdout.write(`Not published. The edited prompt still contains secrets (${reasons}). It stays pending.\n`);
          kept.push(item);
          writePending(cwd, user, [...kept, ...items.slice(index + 1)]);
          continue;
        }
        const rel = publishPrompt(cwd, user, item);
        stdout.write(`Published ${rel}\n`);
        writePending(cwd, user, [...kept, ...items.slice(index + 1)]);
        continue;
      }
      if (answer === 'p' || answer === 'publish') {
        const findings = scan(item.text, { cwd });
        if (findings.length) {
          const reasons = [...new Set(findings.map((finding) => finding.reason))].join(', ');
          stdout.write(`Not published. The prompt still contains secrets (${reasons}). It stays pending.\n`);
          kept.push(item);
          continue;
        }
        const rel = publishPrompt(cwd, user, item);
        stdout.write(`Published ${rel}\n`);
        writePending(cwd, user, [...kept, ...items.slice(index + 1)]);
        continue;
      }
      stdout.write('Unknown choice. The prompt stays pending.\n');
      kept.push(item);
    }
  } finally {
    rl.close();
    writePending(cwd, user, kept);
  }
  return 0;
}

function printList(cwd, stdout) {
  const user = currentUser(cwd);
  const items = readPending(cwd, user);
  stdout.write(`${items.length} pending prompt(s) for ${user}\n`);
  items.forEach((item, index) => {
    stdout.write(`[${index + 1}] ${item.ts || 'unknown time'}  ${preview(item.text)}\n`);
  });
}

async function main(argv = process.argv.slice(2)) {
  const cwd = process.cwd();
  const command = argv[0];
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === 'review') {
    if (argv.includes('--list')) {
      printList(cwd, process.stdout);
      return 0;
    }
    return reviewInteractive(cwd, process.stdout, process.stdin);
  }
  if (command === 'status') {
    process.stdout.write(`${statusReport(cwd)}\n`);
    return 0;
  }
  if (command === 'check-staged') {
    const result = checkStaged(cwd);
    if (!result.ok) {
      process.stdout.write(`${result.message}\n`);
      return 1;
    }
    return 0;
  }
  if (command === 'build-usage') {
    buildUsage(cwd);
    process.stdout.write('Wrote AI_USAGE.md\n');
    return 0;
  }
  process.stderr.write(`Unknown command: ${command}\n${HELP}`);
  return 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code ?? 0),
    (error) => {
      process.stderr.write(`${error?.message || 'cli failed'}\n`);
      process.exit(1);
    },
  );
}
