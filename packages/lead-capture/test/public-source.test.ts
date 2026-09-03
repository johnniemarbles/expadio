import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ALLOWED_ORIGINS,
  PUBLISHABLE_KEY_PATTERN,
  generatePublishableKey,
  isValidPublishableKey,
  normalizeOrigin,
  normalizeOrigins,
  originAllowed,
} from '../src/public-source.ts';

test('generated publishable keys satisfy the database format check', () => {
  for (let i = 0; i < 200; i += 1) {
    const key = generatePublishableKey();
    assert.match(key, PUBLISHABLE_KEY_PATTERN);
    assert.equal(isValidPublishableKey(key), true);
  }
  assert.equal(isValidPublishableKey('sk_not_a_key'), false);
  assert.equal(isValidPublishableKey(null), false);
});

test('origins normalize, dedupe, require one, and cap at the limit', () => {
  assert.equal(normalizeOrigin('https://Example.com/apply?x=1#z'), 'https://example.com');
  assert.equal(normalizeOrigin('http://localhost:3000/form'), 'http://localhost:3000');
  assert.throws(() => normalizeOrigin('example.com'), /ORIGIN_INVALID/);
  assert.throws(() => normalizeOrigin('ftp://example.com'), /ORIGIN_SCHEME_UNSUPPORTED/);

  assert.deepEqual(normalizeOrigins(['https://a.com', 'https://A.com/', 'https://b.com']), ['https://a.com', 'https://b.com']);
  assert.throws(() => normalizeOrigins(['', '  ']), /ORIGIN_REQUIRED/);
  assert.throws(() => normalizeOrigins(Array.from({ length: MAX_ALLOWED_ORIGINS + 1 }, (_, i) => `https://h${i}.example`)), /TOO_MANY_ORIGINS/);
});

test('origin allow check matches by normalized origin only', () => {
  const allow = ['https://example.com', 'http://localhost:3000'];
  assert.equal(originAllowed(allow, 'https://example.com/apply'), true);
  assert.equal(originAllowed(allow, 'https://evil.com'), false);
  assert.equal(originAllowed(allow, null), false);
});
