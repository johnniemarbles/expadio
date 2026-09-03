import { randomBytes } from 'node:crypto';

/**
 * PUBLIC-rail capture source helpers.
 *
 * A PUBLIC source runs in an untrusted browser and cannot hold a signing
 * secret, so it is identified by a *publishable* key and bound to an origin
 * allowlist. Neither value is confidential — they authorize nothing on their
 * own (the OTP gate and organization RLS do that). These helpers are the single
 * source of truth for the publishable-key format and origin normalization, and
 * they MUST stay in agreement with the database constraints in migration 0134:
 *   - lead_capture_sources_publishable_key_format  (the regex below)
 *   - lead_capture_sources_allowed_origins_bounded (non-empty, <= 20)
 */

/** Matches CHECK lead_capture_sources_publishable_key_format. */
export const PUBLISHABLE_KEY_PATTERN = /^cpk_[A-Za-z0-9]{32,64}$/u;

/** Matches CHECK lead_capture_sources_allowed_origins_bounded. */
export const MAX_ALLOWED_ORIGINS = 20;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A public, non-secret client identifier. 40 base62 characters is unguessable
 * enough to avoid accidental collisions without pretending to be a credential.
 */
export function generatePublishableKey(): string {
  const bytes = randomBytes(40);
  let body = '';
  for (const byte of bytes) body += BASE62[byte % 62];
  return `cpk_${body}`;
}

/**
 * Normalize a caller-supplied origin to a bare `scheme://host[:port]` — no path,
 * query, hash, or default port. Only http/https are accepted; anything else,
 * including a bare host with no scheme, is rejected.
 */
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

/**
 * Normalize, deduplicate and bound an origin allowlist. A PUBLIC source needs at
 * least one origin; empty entries are dropped before the minimum is checked so a
 * list of blanks fails as ORIGIN_REQUIRED rather than passing silently.
 */
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

/** Exact-match check used by the Rail B endpoint against a request's Origin. */
export function originAllowed(allowlist: readonly string[], requestOrigin: string | null): boolean {
  if (!requestOrigin) return false;
  let normalized: string;
  try {
    normalized = normalizeOrigin(requestOrigin);
  } catch {
    return false;
  }
  return allowlist.includes(normalized);
}
