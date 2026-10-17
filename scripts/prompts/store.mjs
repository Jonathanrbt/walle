import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function pendingPath(cwd, user) {
  return path.join(cwd, '.prompts-pending', `${user}.jsonl`);
}

export function approvedPath(cwd) {
  return path.join(cwd, '.prompts-pending', 'approved.json');
}

function oneLine(obj) {
  return JSON.stringify(obj).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function readPending(cwd, user) {
  let raw;
  try {
    raw = fs.readFileSync(pendingPath(cwd, user), 'utf8');
  } catch {
    return [];
  }
  const items = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.id === 'string' && typeof obj.text === 'string') items.push(obj);
    } catch {
      // Drop unreadable lines. They are never rewritten.
    }
  }
  return items;
}

export function writePending(cwd, user, items) {
  const file = pendingPath(cwd, user);
  if (!items.length) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${items.map(oneLine).join('\n')}\n`);
}

export function readApproved(cwd) {
  try {
    const data = JSON.parse(fs.readFileSync(approvedPath(cwd), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return data;
  } catch {
    return {};
  }
}

/** Merge one path → sha256 entry. Other keys are kept. Keys are written sorted. */
export function recordApproval(cwd, rel, hash) {
  const file = approvedPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = readApproved(cwd);
  data[rel] = hash;
  const sorted = {};
  for (const key of Object.keys(data).sort()) sorted[key] = data[key];
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}
