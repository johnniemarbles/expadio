import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * OTP challenge crypto for the PUBLIC (Rail B) capture gate.
 *
 * Codes are 6 uniform digits, stored ONLY as a salted SHA-256 hash. The
 * plaintext is delivered out of band (Communications) and never persisted or
 * logged. Comparison is constant-time. These helpers hold no database or HTTP
 * concerns so they are unit-testable in isolation.
 */

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_SECONDS = 600; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_RESENDS = 3;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0');
}

export function newOtpSalt(): string {
  return randomBytes(16).toString('hex');
}

export function hashOtp(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

export function verifyOtpHash(code: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOtp(code, salt), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(actual, expected);
}

export function otpExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_SECONDS * 1000);
}

/** Stable, non-reversible hash of a contact value (email/phone) or an IP, used
 *  for verification destinations and rate keys. Lower-cased + trimmed so the
 *  same contact keys consistently. */
export function hashToken(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export type OtpOutcome = 'VERIFIED' | 'INVALID' | 'EXPIRED' | 'LOCKED' | 'ALREADY_VERIFIED';

export interface OtpAttemptResult {
  readonly outcome: OtpOutcome;
  readonly attemptsAfter: number;
  readonly lock: boolean;
}

/**
 * Decide the result of one OTP attempt against a stored challenge. Pure: the
 * caller performs the corresponding database update (mark VERIFIED / bump
 * attempts / LOCK / EXPIRE).
 */
export function evaluateOtpAttempt(input: {
  readonly status: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'LOCKED';
  readonly expiresAt: Date;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly suppliedCode: string;
  readonly salt: string;
  readonly codeHash: string;
  readonly now?: Date;
}): OtpAttemptResult {
  const now = input.now ?? new Date();
  if (input.status === 'VERIFIED') return { outcome: 'ALREADY_VERIFIED', attemptsAfter: input.attempts, lock: false };
  if (input.status === 'LOCKED' || input.attempts >= input.maxAttempts) {
    return { outcome: 'LOCKED', attemptsAfter: input.attempts, lock: true };
  }
  if (input.status === 'EXPIRED' || now.getTime() > input.expiresAt.getTime()) {
    return { outcome: 'EXPIRED', attemptsAfter: input.attempts, lock: false };
  }
  if (/^\d{6}$/u.test(input.suppliedCode) && verifyOtpHash(input.suppliedCode, input.salt, input.codeHash)) {
    return { outcome: 'VERIFIED', attemptsAfter: input.attempts, lock: false };
  }
  const attemptsAfter = input.attempts + 1;
  return { outcome: 'INVALID', attemptsAfter, lock: attemptsAfter >= input.maxAttempts };
}
