/**
 * PUBLIC (Rail B) ingress guards: abuse controls that do not touch crypto or the
 * database. Pure and unit-testable. Header parsing lives in the route (it owns
 * the wire header names from @expadio/lead-capture); this module holds the
 * decisions those inputs feed.
 */

/** Publishable keys are public identifiers, not secrets (see migration 0134). */
export const PUBLISHABLE_KEY_PATTERN = /^cpk_[A-Za-z0-9]{32,64}$/u;

export function isValidPublishableKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && PUBLISHABLE_KEY_PATTERN.test(value);
}

/** Rolling-window rate limits for a single PUBLIC source. */
export const RATE_WINDOW_SECONDS = 3600;
export const RATE_MAX_PER_IP = 30;
export const RATE_MAX_PER_EMAIL = 5;

export interface RateDecision {
  readonly allowed: boolean;
  readonly dimension: 'IP' | 'EMAIL' | null;
}

/**
 * Given the counts of prior attempts (within the window, INCLUDING the current
 * one just recorded) decide whether to admit. Email is the tighter bound — a
 * single person retrying a form a handful of times is normal; dozens is not.
 */
export function evaluateRateLimit(input: { ipCount: number; emailCount: number }): RateDecision {
  if (input.emailCount > RATE_MAX_PER_EMAIL) return { allowed: false, dimension: 'EMAIL' };
  if (input.ipCount > RATE_MAX_PER_IP) return { allowed: false, dimension: 'IP' };
  return { allowed: true, dimension: null };
}

/** First hop of an X-Forwarded-For chain, or null. Never trusted for authz —
 *  only used, hashed, as a rate key. */
export function clientIpFromForwardedFor(header: string | null): string | null {
  if (!header) return null;
  const first = header.split(',')[0]?.trim();
  return first && first.length <= 64 ? first : null;
}
