import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OTP_MAX_ATTEMPTS,
  evaluateOtpAttempt,
  generateOtpCode,
  hashOtp,
  hashToken,
  newOtpSalt,
  otpExpiry,
  verifyOtpHash,
} from '../lib/lead-capture-otp.ts';
import {
  clientIpFromForwardedFor,
  evaluateRateLimit,
  isValidPublishableKey,
  RATE_MAX_PER_EMAIL,
  RATE_MAX_PER_IP,
} from '../lib/lead-capture-public-guard.ts';

test('OTP codes are 6 digits and hashes round-trip; wrong codes fail constant-time compare', () => {
  for (let i = 0; i < 100; i += 1) assert.match(generateOtpCode(), /^\d{6}$/u);
  const code = '123456';
  const salt = newOtpSalt();
  const hash = hashOtp(code, salt);
  assert.equal(verifyOtpHash(code, salt, hash), true);
  assert.equal(verifyOtpHash('654321', salt, hash), false);
  assert.equal(verifyOtpHash(code, newOtpSalt(), hash), false, 'a different salt must not verify');
  assert.equal(verifyOtpHash(code, salt, 'zz'), false, 'malformed stored hash never verifies');
});

test('contact/IP hashing is stable, case-insensitive, and non-reversible-looking', () => {
  assert.equal(hashToken(' Lead@Example.COM '), hashToken('lead@example.com'));
  assert.match(hashToken('203.0.113.7'), /^[0-9a-f]{64}$/u);
  assert.notEqual(hashToken('a@b.com'), 'a@b.com');
});

test('OTP attempt evaluation covers verified / invalid / lock / expired / already-verified', () => {
  const salt = newOtpSalt();
  const codeHash = hashOtp('111222', salt);
  const base = { salt, codeHash, maxAttempts: OTP_MAX_ATTEMPTS, expiresAt: otpExpiry(), attempts: 0 } as const;

  assert.equal(evaluateOtpAttempt({ ...base, status: 'PENDING', suppliedCode: '111222' }).outcome, 'VERIFIED');

  const invalid = evaluateOtpAttempt({ ...base, status: 'PENDING', suppliedCode: '000000' });
  assert.equal(invalid.outcome, 'INVALID');
  assert.equal(invalid.attemptsAfter, 1);
  assert.equal(invalid.lock, false);

  const lastTry = evaluateOtpAttempt({ ...base, attempts: OTP_MAX_ATTEMPTS - 1, status: 'PENDING', suppliedCode: '000000' });
  assert.equal(lastTry.outcome, 'INVALID');
  assert.equal(lastTry.lock, true, 'the final wrong attempt locks the challenge');

  assert.equal(evaluateOtpAttempt({ ...base, attempts: OTP_MAX_ATTEMPTS, status: 'PENDING', suppliedCode: '111222' }).outcome, 'LOCKED');
  assert.equal(evaluateOtpAttempt({ ...base, status: 'LOCKED', suppliedCode: '111222' }).outcome, 'LOCKED');
  assert.equal(evaluateOtpAttempt({ ...base, status: 'VERIFIED', suppliedCode: '111222' }).outcome, 'ALREADY_VERIFIED');
  assert.equal(
    evaluateOtpAttempt({ ...base, status: 'PENDING', suppliedCode: '111222', expiresAt: new Date(Date.now() - 1000) }).outcome,
    'EXPIRED',
  );
});

test('a correct but expired code does not verify', () => {
  const salt = newOtpSalt();
  const result = evaluateOtpAttempt({
    status: 'PENDING', attempts: 0, maxAttempts: OTP_MAX_ATTEMPTS,
    salt, codeHash: hashOtp('424242', salt), suppliedCode: '424242',
    expiresAt: new Date(Date.now() - 5000),
  });
  assert.equal(result.outcome, 'EXPIRED');
});

test('rate limit blocks over the per-email and per-IP window bounds', () => {
  assert.deepEqual(evaluateRateLimit({ ipCount: 1, emailCount: 1 }), { allowed: true, dimension: null });
  assert.deepEqual(evaluateRateLimit({ ipCount: 1, emailCount: RATE_MAX_PER_EMAIL + 1 }), { allowed: false, dimension: 'EMAIL' });
  assert.deepEqual(evaluateRateLimit({ ipCount: RATE_MAX_PER_IP + 1, emailCount: 1 }), { allowed: false, dimension: 'IP' });
  // Exactly at the bound is still allowed.
  assert.equal(evaluateRateLimit({ ipCount: RATE_MAX_PER_IP, emailCount: RATE_MAX_PER_EMAIL }).allowed, true);
});

test('forwarded-for takes only the first hop and rejects junk', () => {
  assert.equal(clientIpFromForwardedFor('203.0.113.7, 10.0.0.1'), '203.0.113.7');
  assert.equal(clientIpFromForwardedFor(null), null);
  assert.equal(clientIpFromForwardedFor('x'.repeat(100)), null);
});

test('publishable key validation matches the cpk_ format', () => {
  assert.equal(isValidPublishableKey(`cpk_${'a'.repeat(40)}`), true);
  assert.equal(isValidPublishableKey('sk_secret'), false);
  assert.equal(isValidPublishableKey(null), false);
  assert.equal(isValidPublishableKey('cpk_short'), false);
});
