import { createPublicKey, verify } from 'node:crypto';

export const CAPTURE_SIGNATURE_HEADER = 'x-expadio-capture-signature';
export const CAPTURE_TIMESTAMP_HEADER = 'x-expadio-capture-timestamp';
export const CAPTURE_IDEMPOTENCY_HEADER = 'x-expadio-idempotency-key';
export const MAX_CAPTURE_BODY_BYTES = 256 * 1024;

export interface CaptureIngressSource {
  readonly sourceId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly sourceKey: string;
  readonly layerKey: string | null;
  readonly verificationAlgorithm: 'ED25519';
  readonly verificationPublicKey: string;
  readonly verificationKeyId: string;
  readonly maxClockSkewSeconds: number;
}

export function canonicalCaptureSignaturePayload(timestamp: string, rawBody: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from('.', 'utf8'), Buffer.from(rawBody)]);
}

export function parseCaptureTimestamp(raw: string, now = new Date()): Date {
  if (!/^\d{10}$/u.test(raw)) throw new Error('CAPTURE_TIMESTAMP_INVALID');
  const parsed = new Date(Number(raw) * 1000);
  if (!Number.isFinite(parsed.getTime())) throw new Error('CAPTURE_TIMESTAMP_INVALID');
  if (parsed.getTime() > now.getTime() + 5_000) throw new Error('CAPTURE_TIMESTAMP_IN_FUTURE');
  return parsed;
}

export function verifyCaptureSignature(input: {
  readonly publicKeyPem: string;
  readonly signatureBase64: string;
  readonly timestamp: string;
  readonly rawBody: Uint8Array;
  readonly now?: Date;
  readonly maxClockSkewSeconds: number;
}): boolean {
  const timestamp = parseCaptureTimestamp(input.timestamp, input.now);
  const now = input.now ?? new Date();
  if (now.getTime() - timestamp.getTime() > input.maxClockSkewSeconds * 1000) {
    throw new Error('CAPTURE_SIGNATURE_EXPIRED');
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(input.signatureBase64, 'base64');
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;

  const key = createPublicKey(input.publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('CAPTURE_VERIFICATION_KEY_INVALID');
  return verify(
    null,
    canonicalCaptureSignaturePayload(input.timestamp, input.rawBody),
    key,
    signature,
  );
}

export function validatedCapturePayload(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CAPTURE_PAYLOAD_OBJECT_REQUIRED');
  }
  return value as Record<string, unknown>;
}

export function captureLeadFields(payload: Record<string, unknown>): {
  readonly title: string | null;
  readonly email: string | null;
  readonly externalReference: string | null;
} {
  const clean = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed.slice(0, max);
  };
  return {
    title: clean(payload.title, 200),
    email: clean(payload.email, 320),
    externalReference: clean(payload.externalReference, 200),
  };
}
