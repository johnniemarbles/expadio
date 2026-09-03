/**
 * Signed capture — the trusted (Rail A) path.
 *
 * For callers that CAN hold a secret: a server backend, the SDK's server build,
 * or an inbound-channel adapter. Produces an Ed25519 signature over
 * `${timestamp}.${body}` — byte-for-byte what the live ingress verifies
 * (apps/platform-web/lib/lead-capture-ingress.ts) — using WebCrypto, so the same
 * code runs under Node and edge runtimes without a node:crypto dependency.
 *
 * Only a PKCS#8 *private* key is handled here, and only in trusted server code.
 * The matching public key lives on the source row; no secret is ever shipped to
 * a browser (that is what the PUBLIC rail and its publishable key are for).
 */
import {
  CAPTURE_IDEMPOTENCY_HEADER,
  CAPTURE_SIGNATURE_HEADER,
  CAPTURE_TIMESTAMP_HEADER,
  captureSigningBytes,
  serializeSubmission,
  type CaptureSubmissionInput,
} from './contract.ts';
import { normalizeSubmission } from './normalize.ts';
import { newIdempotencyKey, type CaptureResult } from './client.ts';

function bytesFromBase64(base64: string): Uint8Array {
  const g = globalThis as { atob?: (s: string) => string; Buffer?: { from(s: string, enc: string): Uint8Array } };
  if (typeof g.atob === 'function') {
    const binary = g.atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  if (g.Buffer) return new Uint8Array(g.Buffer.from(base64, 'base64'));
  throw new Error('No base64 decoder available.');
}

function base64FromBytes(bytes: Uint8Array): string {
  const g = globalThis as { btoa?: (s: string) => string; Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } };
  if (typeof g.btoa === 'function') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return g.btoa(binary);
  }
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64');
  throw new Error('No base64 encoder available.');
}

function pkcs8DerFromPem(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/u, '')
    .replace(/-----END [A-Z ]+-----/u, '')
    .replace(/\s+/gu, '');
  if (body === '') throw new Error('An Ed25519 PKCS#8 private key (PEM) is required.');
  return bytesFromBase64(body);
}

function subtleOf(override?: SubtleCrypto): SubtleCrypto {
  const subtle = override ?? (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is not available in this runtime.');
  return subtle;
}

export interface SignedCaptureHeaders {
  readonly [CAPTURE_SIGNATURE_HEADER]: string;
  readonly [CAPTURE_TIMESTAMP_HEADER]: string;
  readonly [CAPTURE_IDEMPOTENCY_HEADER]: string;
}

/** Sign an already-serialized body. Returns the exact headers the ingress reads. */
export async function signCaptureBody(input: {
  readonly privateKeyPkcs8Pem: string;
  readonly body: Uint8Array;
  readonly idempotencyKey: string;
  readonly timestampSeconds?: number;
  readonly subtle?: SubtleCrypto;
}): Promise<Record<string, string>> {
  const subtle = subtleOf(input.subtle);
  const key = await subtle.importKey('pkcs8', pkcs8DerFromPem(input.privateKeyPkcs8Pem), { name: 'Ed25519' }, false, ['sign']);
  const timestamp = String(input.timestampSeconds ?? Math.floor(Date.now() / 1000));
  const signature = new Uint8Array(await subtle.sign({ name: 'Ed25519' }, key, captureSigningBytes(timestamp, input.body)));
  return {
    [CAPTURE_SIGNATURE_HEADER]: base64FromBytes(signature),
    [CAPTURE_TIMESTAMP_HEADER]: timestamp,
    [CAPTURE_IDEMPOTENCY_HEADER]: input.idempotencyKey,
  };
}

export interface ServerCaptureClientOptions {
  /** Base origin of the ingress, e.g. `https://api.expadio.com`. */
  readonly baseUrl: string;
  readonly tenantId: string;
  readonly sourceId: string;
  readonly privateKeyPkcs8Pem: string;
  readonly fetchImpl?: typeof fetch;
  readonly idempotencyKey?: () => string;
  readonly subtle?: SubtleCrypto;
}

/** A trusted server-to-server client that normalizes, signs, and posts to the
 *  signed ingress at `/api/lead-capture/ingest/{sourceId}?tenantId={tenantId}`. */
export function createServerCaptureClient(options: ServerCaptureClientOptions) {
  const doFetch = (options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch)!;
  if (!doFetch) throw new Error('No fetch implementation is available.');
  const nextKey = options.idempotencyKey ?? newIdempotencyKey;
  const url = `${options.baseUrl.replace(/\/$/u, '')}/api/lead-capture/ingest/${encodeURIComponent(options.sourceId)}?tenantId=${encodeURIComponent(options.tenantId)}`;

  async function submit(input: CaptureSubmissionInput): Promise<CaptureResult> {
    const body = serializeSubmission(normalizeSubmission(input));
    const idempotencyKey = nextKey();
    const headers = await signCaptureBody({ privateKeyPkcs8Pem: options.privateKeyPkcs8Pem, body, idempotencyKey, subtle: options.subtle });
    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `Capture failed (${response.status}).`);
    }
    return {
      accepted: payload.accepted === true,
      replayed: payload.replayed === true,
      captureLeadId: typeof payload.captureLeadId === 'string' ? payload.captureLeadId : null,
      requiresVerification: payload.requiresVerification === true,
    };
  }

  return { submit };
}
