import fs from 'node:fs';
import path from 'node:path';

const MARKER_RE = /\[REDACTED:[A-Za-z0-9_.:-]*\]/g;
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
const PEM_BLOCK_RE = /-----BEGIN [A-Z0-9][A-Z0-9 ]*-----[ \t]*\r?\n[\s\S]*?-----END [A-Z0-9][A-Z0-9 ]*-----[ \t]*/g;
const PEM_MARK_RE = /^-----BEGIN [A-Z0-9][A-Z0-9 ]*-----$/;
const PEM_END_RE = /^-----END [A-Z0-9][A-Z0-9 ]*-----$/;
const B64_LINE_RE = /^[A-Za-z0-9+/=]{40,}$/;
const AUTH_RE = /Authorization\s*:\s*[^\r\n]+/gi;
const BEARER_RE = /Bearer\s+\S+/gi;
const LONG_RE = /[A-Za-z0-9+/_=-]{40,}/g;
const HEX_RE = /(?<![A-Za-z0-9])[0-9a-fA-F]{32,}(?![A-Za-z0-9])/g;
const ASSIGN_RE = /([A-Za-z_][A-Za-z0-9_.-]*)(\s*[=:]\s*)("([^"]*)"|'([^']*)'|([^\s"'#]+))/g;
const SECRET_NAME_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE)/i;

const PREFIXES = [
  { re: /github_pat_[A-Za-z0-9_]{8,}/g, reason: 'github_pat_' },
  { re: /glpat-[A-Za-z0-9_-]{8,}/g, reason: 'glpat-' },
  { re: /ghp_[A-Za-z0-9]{8,}/g, reason: 'ghp_' },
  { re: /gho_[A-Za-z0-9]{8,}/g, reason: 'gho_' },
  { re: /xox[bap]-[A-Za-z0-9-]{8,}/g, reason: 'slack' },
  { re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/g, reason: 'sk-' },
  { re: /AKIA[A-Za-z0-9]{8,}/g, reason: 'AKIA' },
  { re: /AIza[A-Za-z0-9_-]{8,}/g, reason: 'AIza' },
];

/**
 * @param {string} text
 * @param {{ cwd?: string }} [options]
 * @returns {string}
 */
export function redact(text, options = {}) {
  const source = String(text ?? '');
  return applyRanges(source, collect(source, options));
}

/**
 * Same detectors as {@link redact}. Existing `[REDACTED:...]` markers are not findings.
 * @param {string} text
 * @param {{ cwd?: string }} [options]
 * @returns {{ reason: string, start: number, end: number }[]}
 */
export function scan(text, options = {}) {
  const source = String(text ?? '');
  return collect(source, options).map(({ reason, start, end }) => ({ reason, start, end }));
}

function safeReason(reason) {
  const cleaned = String(reason ?? '').replace(/[^A-Za-z0-9_.:-]/g, '');
  return cleaned || 'secret';
}

function applyRanges(text, ranges) {
  let out = '';
  let cursor = 0;
  for (const range of ranges) {
    out += text.slice(cursor, range.start);
    out += `[REDACTED:${safeReason(range.reason)}]`;
    cursor = range.end;
  }
  out += text.slice(cursor);
  return out;
}

function collect(text, options) {
  const protectedRanges = [
    ...rangesFrom(text, MARKER_RE),
    ...shortUrlRanges(text),
  ];
  const candidates = [
    ...envRanges(text, options.cwd),
    ...pemRanges(text),
    ...regexRanges(text, AUTH_RE, 'authorization', 3),
    ...regexRanges(text, BEARER_RE, 'bearer', 3),
    ...prefixRanges(text),
    ...assignmentRanges(text),
    ...regexRanges(text, HEX_RE, 'hex', 5),
    ...regexRanges(text, LONG_RE, 'long-token', 6),
  ];
  const visible = candidates.filter((candidate) => !overlapsAny(candidate, protectedRanges));
  return resolveOverlaps(visible);
}

function rangesFrom(text, re) {
  const copy = new RegExp(re.source, re.flags);
  const ranges = [];
  for (const match of text.matchAll(copy)) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function shortUrlRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(URL_RE)) {
    if (match[0].length < 80) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

function regexRanges(text, re, reason, priority) {
  const copy = new RegExp(re.source, re.flags);
  const ranges = [];
  for (const match of text.matchAll(copy)) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      reason,
      priority,
    });
  }
  return ranges;
}

function prefixRanges(text) {
  const ranges = [];
  for (const { re, reason } of PREFIXES) {
    ranges.push(...regexRanges(text, re, reason, 2));
  }
  return ranges;
}

function envFiles(cwd) {
  if (!cwd) return [];
  let entries;
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && (entry.name === '.env' || entry.name.startsWith('.env.')))
    .map((entry) => path.join(cwd, entry.name))
    .sort();
}

function envSecrets(cwd) {
  /** @type {Map<string, string>} */
  const byValue = new Map();
  for (const file of envFiles(cwd)) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { name, value } of parseDotenv(raw)) {
      consider(byValue, value, name);
      if (value.includes('\n')) {
        for (const line of value.split(/\r?\n/)) consider(byValue, line, name);
      }
    }
  }
  return [...byValue.entries()].map(([value, reason]) => ({ value, reason }));
}

function consider(byValue, value, name) {
  if (typeof value !== 'string') return;
  if (value.length < 8) return;
  if (!byValue.has(value)) byValue.set(value, name);
}

function envRanges(text, cwd) {
  const ranges = [];
  for (const { value, reason } of envSecrets(cwd)) {
    let from = 0;
    while (from <= text.length - value.length) {
      const found = text.indexOf(value, from);
      if (found === -1) break;
      ranges.push({
        start: found,
        end: found + value.length,
        reason,
        priority: 0,
      });
      from = found + 1;
    }
  }
  return ranges;
}

function pemRanges(text) {
  const ranges = regexRanges(text, PEM_BLOCK_RE, 'pem', 1);
  const lines = lineSpans(text);
  const covered = (line) => ranges.some((range) => line.start >= range.start && line.end <= range.end);
  for (const line of lines) {
    const trimmed = line.line.trim();
    if (!PEM_MARK_RE.test(trimmed) && !PEM_END_RE.test(trimmed)) continue;
    if (covered(line)) continue;
    let lo = line.index;
    let hi = line.index;
    while (lo > 0 && B64_LINE_RE.test(lines[lo - 1].line.trim())) lo -= 1;
    while (hi + 1 < lines.length && B64_LINE_RE.test(lines[hi + 1].line.trim())) hi += 1;
    ranges.push({
      start: lines[lo].start,
      end: lines[hi].end,
      reason: 'pem',
      priority: 1,
    });
  }
  return ranges;
}

function lineSpans(text) {
  const spans = [];
  let start = 0;
  const parts = text.split('\n');
  for (let index = 0; index < parts.length; index += 1) {
    let line = parts[index];
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const end = start + line.length;
    spans.push({ line, start, end, index });
    start = end + 1;
  }
  return spans;
}

function assignmentRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(ASSIGN_RE)) {
    const name = match[1];
    if (!SECRET_NAME_RE.test(name)) continue;
    const lead = match[2];
    const rawVal = match[3];
    let start = match.index + name.length + lead.length;
    let end = start + rawVal.length;
    if (
      (rawVal.startsWith('"') && rawVal.endsWith('"') && rawVal.length >= 2)
      || (rawVal.startsWith("'") && rawVal.endsWith("'") && rawVal.length >= 2)
    ) {
      start += 1;
      end -= 1;
    }
    if (end <= start) continue;
    ranges.push({ start, end, reason: name, priority: 4 });
  }
  return ranges;
}

function overlapsAny(candidate, ranges) {
  return ranges.some((range) => candidate.start < range.end && range.start < candidate.end);
}

function resolveOverlaps(candidates) {
  const sorted = [...candidates].sort((a, b) => {
    const byLength = (b.end - b.start) - (a.end - a.start);
    if (byLength) return byLength;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.start - b.start;
  });
  const kept = [];
  for (const candidate of sorted) {
    if (candidate.end <= candidate.start) continue;
    if (overlapsAny(candidate, kept)) continue;
    kept.push(candidate);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

function parseDotenv(raw) {
  const text = String(raw).replace(/^\uFEFF/, '');
  const entries = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r')) i += 1;
    if (i >= text.length) break;
    if (text[i] === '\n') {
      i += 1;
      continue;
    }
    if (text[i] === '#') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (text.startsWith('export ', i) || text.startsWith('export\t', i)) {
      i += 7;
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
    }
    const nameStart = i;
    if (!/[A-Za-z_]/.test(text[i] || '')) {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    i += 1;
    while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i += 1;
    const name = text.slice(nameStart, i);
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
    if (text[i] !== '=') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    i += 1;
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
    let value = '';
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      i += 1;
      while (i < text.length) {
        if (quote === '"' && text[i] === '\\' && i + 1 < text.length) {
          const escaped = text[i + 1];
          const map = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };
          value += map[escaped] ?? escaped;
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i += 1;
          break;
        }
        value += text[i];
        i += 1;
      }
    } else {
      const start = i;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
      value = text.slice(start, i).replace(/\s+#.*$/, '').trim();
    }
    entries.push({ name, value });
    while (i < text.length && text[i] !== '\n') i += 1;
    if (text[i] === '\n') i += 1;
  }
  return entries;
}
