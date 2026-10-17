import { spawnSync } from 'node:child_process';

/** Lowercase slug limited to [a-z0-9-]. Empty when the input has no usable characters. */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug of `git config user.name` when `cwd` is inside a work tree
 * (local config wins, then global). Otherwise `$USER`, then "unknown".
 */
export function currentUser(cwd) {
  return slugify(gitUserName(cwd)) || slugify(process.env.USER || process.env.USERNAME || '') || 'unknown';
}

function gitUserName(cwd) {
  if (!cwd) return '';
  const inside = spawnSync('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
  });
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') return '';
  const got = spawnSync('git', ['-C', cwd, 'config', '--get', 'user.name'], {
    encoding: 'utf8',
  });
  if (got.status !== 0) return '';
  return got.stdout.trim();
}
