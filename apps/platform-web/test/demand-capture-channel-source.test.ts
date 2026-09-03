import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MAX_ALLOWED_ORIGINS,
  PUBLISHABLE_KEY_PATTERN,
  generatePublishableKey,
  normalizeOrigin,
  normalizeOrigins,
  originAllowed,
} from '../lib/lead-capture-public-source.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../infra/db/migrations/0134_demand_capture_channel_public_rail.sql');

test('migration adds channel and trust rail with bounded enums', () => {
  assert.match(migration, /ADD COLUMN channel text NOT NULL DEFAULT 'WEB'/);
  assert.match(migration, /channel IN \('WEB','EMAIL','SMS','WHATSAPP','SOCIAL','IMPORT','MANUAL','API'\)/);
  assert.match(migration, /ADD COLUMN trust_rail text NOT NULL DEFAULT 'SIGNED'/);
  assert.match(migration, /trust_rail IN \('SIGNED','PUBLIC'\)/);
});

test('migration keeps the public rail credential-free', () => {
  assert.match(migration, /lead_capture_sources_publishable_key_format/);
  assert.match(migration, /lead_capture_sources_publishable_key_uq/);
  assert.match(migration, /lead_capture_sources_rail_consistent/);
  // A publishable key is a public identifier, not a secret: no confidential
  // material is introduced for the PUBLIC rail.
  assert.doesNotMatch(migration, /shared_secret/);
  assert.doesNotMatch(migration, /secret_key/);
  assert.doesNotMatch(migration, /private_key/);
});

test('migration opens no unauthenticated read surface', () => {
  // Rail B ingress RLS ships with the endpoint, not with this schema migration.
  assert.doesNotMatch(migration, /CREATE POLICY/);
});

test('generated publishable keys satisfy the database format check', () => {
  for (let i = 0; i < 200; i += 1) {
    const key = generatePublishableKey();
    assert.match(key, PUBLISHABLE_KEY_PATTERN);
    // Mirror the raw regex in migration 0134 so drift is caught here too.
    assert.match(key, /^cpk_[A-Za-z0-9]{32,64}$/u);
  }
});

test('origins normalize to a bare scheme://host[:port]', () => {
  assert.equal(normalizeOrigin('https://Example.com/apply?x=1#z'), 'https://example.com');
  assert.equal(normalizeOrigin('https://example.com:443/'), 'https://example.com');
  assert.equal(normalizeOrigin('http://localhost:3000/form'), 'http://localhost:3000');
  assert.throws(() => normalizeOrigin('example.com'), /ORIGIN_INVALID/);
  assert.throws(() => normalizeOrigin('ftp://example.com'), /ORIGIN_SCHEME_UNSUPPORTED/);
});

test('origin lists dedupe, require at least one, and cap at the limit', () => {
  assert.deepEqual(
    normalizeOrigins(['https://a.com', 'https://A.com/', 'https://b.com']),
    ['https://a.com', 'https://b.com'],
  );
  assert.throws(() => normalizeOrigins([]), /ORIGIN_REQUIRED/);
  assert.throws(() => normalizeOrigins(['', '   ']), /ORIGIN_REQUIRED/);
  const many = Array.from({ length: MAX_ALLOWED_ORIGINS + 1 }, (_, i) => `https://h${i}.example`);
  assert.throws(() => normalizeOrigins(many), /TOO_MANY_ORIGINS/);
});

test('origin allow check matches by normalized origin, rejects everything else', () => {
  const allow = ['https://example.com', 'http://localhost:3000'];
  assert.equal(originAllowed(allow, 'https://example.com'), true);
  assert.equal(originAllowed(allow, 'https://example.com/apply'), true);
  assert.equal(originAllowed(allow, 'http://localhost:3000'), true);
  assert.equal(originAllowed(allow, 'https://evil.com'), false);
  assert.equal(originAllowed(allow, 'http://example.com'), false);
  assert.equal(originAllowed(allow, null), false);
  assert.equal(originAllowed(allow, 'not a url'), false);
});
