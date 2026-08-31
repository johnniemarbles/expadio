import { createHash } from 'node:crypto';

/** Versioned, bounded provider key. Keep local delivery/audit keys unchanged.
 * Persist this value at enqueue time; never derive a replacement for a legacy
 * snapshot or include attempt number, worker identity or mutable sender data. */
export function tenantProviderIdempotencyKey(tenantId: string, idempotencyKey: string): string {
  if (!tenantId || tenantId !== tenantId.trim() || !idempotencyKey || idempotencyKey !== idempotencyKey.trim()) {
    throw new Error('PROVIDER_IDEMPOTENCY_INPUT_INVALID');
  }
  const digest = createHash('sha256').update(JSON.stringify([tenantId, idempotencyKey])).digest('hex');
  return `expadio:tenant:v1:${digest}`;
}
