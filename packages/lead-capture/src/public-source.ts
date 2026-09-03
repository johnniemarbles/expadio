/**
 * PUBLIC-rail source helpers, shared by the management API (create a source) and
 * anywhere a publishable key or origin must be produced/validated. Browser-safe:
 * randomness comes from WebCrypto, so this carries no `node:` import and can ship
 * in either bundle.
 *
 * These MUST stay in agreement with the database constraints in migration 0134:
 *   - lead_capture_sources_publishable_key_format  (PUBLISHABLE_KEY_PATTERN)
 *   - lead_capture_sources_allowed_origins_bounded (non-empty, <= MAX)
 */

/** Matches CHECK lead_capture_sources_publishable_key_format. */
export const PUBLISHABLE_KEY_PATTERN = /^cpk_[A-Za-z0-9]{32,64}$/u;

/** Matches CHECK lead_capture_sources_allowed_origins_bounded. */
export const MAX_ALLOWED_ORIGINS = 20;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A public, non-secret client identifier. 40 base62 chars from a CSPRNG. */
export function generatePublishableKey(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!crypto || typeof crypto.getRandomValues !== 'function') {
    throw new Error('A secure random source is required to generate a publishable key.');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  let body = '';
  for (const byte of bytes) body += BASE62[byte % 62];
  return `cpk_${body}`;
}

export function isValidPublishableKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && PUBLISHABLE_KEY_PATTERN.test(value);
}

/** Normalize an origin to a bare `scheme://host[:port]` — no path/query/hash/default port. */
export function normalizeOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('ORIGIN_INVALID');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('ORIGIN_SCHEME_UNSUPPORTED');
  }
  return url.origin;
}

/** Normalize, dedupe and bound an origin allowlist. Requires at least one. */
export function normalizeOrigins(list: readonly string[]): string[] {
  const origins = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    origins.add(normalizeOrigin(raw));
  }
  const result = [...origins];
  if (result.length < 1) throw new Error('ORIGIN_REQUIRED');
  if (result.length > MAX_ALLOWED_ORIGINS) throw new Error('TOO_MANY_ORIGINS');
  return result;
}

/** Exact-match check of a request Origin against an allowlist. */
export function originAllowed(allowlist: readonly string[], requestOrigin: string | null): boolean {
  if (!requestOrigin) return false;
  try {
    return allowlist.includes(normalizeOrigin(requestOrigin));
  } catch {
    return false;
  }
}
