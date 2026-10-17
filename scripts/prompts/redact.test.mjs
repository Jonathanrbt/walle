import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { redact, scan } from './redact.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'redact-'));
}

test('redacts .env values, quoted values, and long lines of multiline values', () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, '.env'), [
    'DB_PASSWORD="correct-horse-battery"',
    'SHORT=abc',
    'export MULTI="aaaaaaaa',
    'bbbbbbbb"',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(cwd, '.env.local'), 'API_TOKEN=token-value-123\n');

  const text = 'pw correct-horse-battery and token-value-123 and bbbbbbbb and abc stays';
  const out = redact(text, { cwd });
  assert.equal(out.includes('correct-horse-battery'), false);
  assert.equal(out.includes('token-value-123'), false);
  assert.equal(out.includes('bbbbbbbb'), false);
  assert.match(out, /\[REDACTED:DB_PASSWORD\]/);
  assert.match(out, /\[REDACTED:API_TOKEN\]/);
  assert.match(out, /\[REDACTED:MULTI\]/);
  assert.match(out, /abc stays/);
});

test('redacts PEM blocks and a lone BEGIN line with an adjacent base64 line', () => {
  const cwd = tempDir();
  const block = [
    'before',
    '-----BEGIN PRIVATE KEY-----',
    'MIIBVwIBADANBgkqhkiG9w0BAQEFAASCAUEwggE9',
    '-----END PRIVATE KEY-----',
    'after',
  ].join('\n');
  const out = redact(block, { cwd });
  assert.equal(out.includes('BEGIN'), false);
  assert.equal(out.includes('MIIB'), false);
  assert.match(out, /before\n\[REDACTED:pem\]\nafter/);

  const lone = `-----BEGIN OPENSSH PRIVATE KEY-----\n${'A'.repeat(44)}\nkeep`;
  const loneOut = redact(lone, { cwd });
  assert.equal(loneOut.includes('BEGIN'), false);
  assert.equal(loneOut.includes('A'.repeat(44)), false);
  assert.match(loneOut, /\[REDACTED:pem\]\nkeep/);
});

test('redacts Bearer, Authorization, token prefixes, and KEY=value', () => {
  const cwd = tempDir();
  assert.equal(
    redact('Authorization: Bearer super-token-value', { cwd }),
    '[REDACTED:authorization]',
  );
  assert.equal(redact('Bearer super-token-value', { cwd }), '[REDACTED:bearer]');

  const prefixed = [
    'ghp_abcdefghijklmnopqrstuvwxyz',
    'gho_abcdefghijklmnopqrstuvwxyz',
    'github_pat_abcdefghijklmnopqrstuvwxyz',
    'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD',
    'xoxb-abcdefghijklmnopqrstuvwxyz',
    'AKIAabcdefghijklmnopqrst',
    'AIzaabcdefghijklmnopqrst',
    'glpat-abcdefghijklmnopqrst',
  ];
  for (const token of prefixed) {
    const out = redact(`use ${token} please`, { cwd });
    assert.equal(out.includes(token), false, token);
    assert.match(out, /\[REDACTED:/);
  }

  assert.equal(
    redact('API_KEY=correct-horse-battery', { cwd }),
    'API_KEY=[REDACTED:API_KEY]',
  );
  assert.equal(
    redact('token: "correct-horse-battery"', { cwd }),
    'token: "[REDACTED:token]"',
  );
});

test('redacts long tokens and 32+ hex, and leaves short URLs alone', () => {
  const cwd = tempDir();
  const token = 'Z'.repeat(40);
  assert.deepEqual(scan(token, { cwd }).map((finding) => finding.reason), ['long-token']);
  assert.equal(redact(`id ${token}`, { cwd }), 'id [REDACTED:long-token]');
  assert.equal(redact('Z'.repeat(39), { cwd }), 'Z'.repeat(39));

  const hex = 'a'.repeat(32);
  assert.deepEqual(scan(hex, { cwd }).map((finding) => finding.reason), ['hex']);
  assert.equal(scan('a'.repeat(31), { cwd }).length, 0);

  const shortUrl = `https://example.com/${'ab'.repeat(16)}`;
  assert.ok(shortUrl.length < 80);
  assert.equal(redact(shortUrl, { cwd }), shortUrl);

  const longToken = 'c'.repeat(40);
  const longUrl = `https://example.com/some/nested/path/for/files?download=1&token=${longToken}`;
  assert.ok(longUrl.length >= 80);
  assert.equal(redact(longUrl, { cwd }).includes(longToken), false);
});

test('leaves ordinary prose unchanged and is idempotent', () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, '.env'), 'DB_PASSWORD=correct-horse-battery\n');
  const prose = 'We built the donation form ourselves and documented the password field in the README. See https://example.com/docs/open-payments.';
  assert.equal(redact(prose, { cwd }), prose);
  assert.deepEqual(scan(prose, { cwd }), []);

  const dirty = [
    prose,
    'API_KEY=correct-horse-battery',
    'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD',
    'correct-horse-battery',
    '-----BEGIN PRIVATE KEY-----',
    'MIIBVwIBADANBgkqhkiG9w0BAQEFAASCAUEwggE9',
    '-----END PRIVATE KEY-----',
  ].join('\n');
  const once = redact(dirty, { cwd });
  assert.equal(redact(once, { cwd }), once);
  assert.deepEqual(scan(once, { cwd }), []);
  assert.deepEqual(scan('safe [REDACTED:sk-] text', { cwd }), []);
  assert.equal(scan(`safe [REDACTED:sk-] ${'Z'.repeat(40)}`, { cwd }).length, 1);
});
