import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ResendWebhookHeaders {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

export interface ResendWebhookVerificationOptions {
  readonly secret: string;
  readonly payload: string;
  readonly headers: ResendWebhookHeaders;
  readonly nowMs?: number;
  readonly toleranceSeconds?: number;
}

const DEFAULT_TOLERANCE_SECONDS = 300;

function nonBlank(value: string | null, code: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized === '' || /[\r\n\t]/u.test(normalized)) throw new Error(code);
  return normalized;
}

function secretBytes(secret: string): Buffer {
  const normalized = nonBlank(secret, 'RESEND_WEBHOOK_SECRET_REQUIRED');
  const encoded = normalized.startsWith('whsec_') ? normalized.slice('whsec_'.length) : normalized;
  if (encoded === '') throw new Error('RESEND_WEBHOOK_SECRET_INVALID');
  return Buffer.from(encoded, 'base64');
}

function expectedSignature(input: {
  readonly secret: string;
  readonly messageId: string;
  readonly timestamp: string;
  readonly payload: string;
}): Buffer {
  const signedContent = `${input.messageId}.${input.timestamp}.${input.payload}`;
  const digest = createHmac('sha256', secretBytes(input.secret))
    .update(signedContent, 'utf8')
    .digest('base64');
  return Buffer.from(digest, 'utf8');
}

function candidateSignatures(header: string): readonly Buffer[] {
  return header
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice('v1,'.length))
    .filter((part) => part !== '')
    .map((part) => Buffer.from(part, 'utf8'));
}

function assertTimestampFresh(timestamp: string, nowMs: number, toleranceSeconds: number): void {
  if (!/^\d+$/u.test(timestamp)) throw new Error('RESEND_WEBHOOK_TIMESTAMP_INVALID');
  const timestampMs = Number.parseInt(timestamp, 10) * 1000;
  if (!Number.isFinite(timestampMs)) throw new Error('RESEND_WEBHOOK_TIMESTAMP_INVALID');
  const skewSeconds = Math.abs(nowMs - timestampMs) / 1000;
  if (skewSeconds > toleranceSeconds) throw new Error('RESEND_WEBHOOK_TIMESTAMP_STALE');
}

export function verifyResendWebhookSignature(options: ResendWebhookVerificationOptions): void {
  const messageId = nonBlank(options.headers.id, 'RESEND_WEBHOOK_ID_REQUIRED');
  const timestamp = nonBlank(options.headers.timestamp, 'RESEND_WEBHOOK_TIMESTAMP_REQUIRED');
  const signature = nonBlank(options.headers.signature, 'RESEND_WEBHOOK_SIGNATURE_REQUIRED');
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  assertTimestampFresh(timestamp, options.nowMs ?? Date.now(), toleranceSeconds);

  const expected = expectedSignature({
    secret: options.secret,
    messageId,
    timestamp,
    payload: options.payload,
  });

  for (const candidate of candidateSignatures(signature)) {
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return;
  }

  throw new Error('RESEND_WEBHOOK_SIGNATURE_INVALID');
}

export function signResendWebhookForTest(input: {
  readonly secret: string;
  readonly messageId: string;
  readonly timestamp: string;
  readonly payload: string;
}): string {
  return `v1,${expectedSignature(input).toString('utf8')}`;
}
