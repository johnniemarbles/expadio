import type { DomainEventOutboxSqlClient, ClaimedDomainEventOutboxItem } from './domain-event-outbox.ts';
import {
  claimDomainEventOutboxBatch,
  extendDomainEventOutboxClaim,
  failDomainEventOutboxClaim,
  publishDomainEventOutboxClaim,
} from './domain-event-outbox.ts';

export interface DomainEventPublishContext {
  readonly item: ClaimedDomainEventOutboxItem;
  readonly renewLease: (leaseSeconds?: number) => Promise<void>;
}

export interface DomainEventPublisher {
  publish(context: DomainEventPublishContext): Promise<void>;
}

export interface DomainEventOutboxBatchRunResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
  readonly dead: number;
  readonly claimLost: number;
}

function positiveInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`DOMAIN_EVENT_OUTBOX_RUNNER_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

export function domainEventOutboxRetryDelaySeconds(input: {
  readonly attempts: number;
  readonly baseDelaySeconds?: number;
  readonly maxDelaySeconds?: number;
}): number {
  const attempts = positiveInteger(input.attempts, 'attempts', 100);
  const base = positiveInteger(input.baseDelaySeconds ?? 15, 'base_delay_seconds', 86400);
  const max = positiveInteger(input.maxDelaySeconds ?? 900, 'max_delay_seconds', 86400);
  if (base > max) {
    throw new Error('DOMAIN_EVENT_OUTBOX_RUNNER_RETRY_DELAY_RANGE_INVALID');
  }

  // attempts=1 → base, attempts=2 → 2*base, etc. Cap exponent to keep
  // the calculation bounded even when maxAttempts is configured unusually high.
  const exponent = Math.min(attempts - 1, 30);
  return Math.min(max, base * (2 ** exponent));
}

function isClaimLost(error: unknown): boolean {
  return error instanceof Error && error.message === 'DOMAIN_EVENT_OUTBOX_CLAIM_LOST';
}

/**
 * Process one tenant-scoped outbox batch.
 *
 * Publisher side effects must be idempotent because a process can crash after
 * the transport accepts an event but before this runner marks the outbox row
 * PUBLISHED. A transport adapter should therefore publish with eventId as its
 * deduplication/message identity whenever the transport supports it.
 *
 * PUBLISHED means transport publication succeeded. Business consumers (such as
 * governed-action materialization) acknowledge their own downstream delivery
 * independently; this runner does not conflate publication with consumption.
 */
export async function runDomainEventOutboxBatch(
  client: DomainEventOutboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly publisher: DomainEventPublisher;
    readonly batchSize?: number;
    readonly leaseSeconds?: number;
    readonly maxAttempts?: number;
    readonly baseRetryDelaySeconds?: number;
    readonly maxRetryDelaySeconds?: number;
    readonly now?: () => Date;
  },
): Promise<DomainEventOutboxBatchRunResult> {
  const now = input.now ?? (() => new Date());
  const leaseSeconds = input.leaseSeconds ?? 60;
  const maxAttempts = input.maxAttempts ?? 8;

  const claimed = await claimDomainEventOutboxBatch(client, {
    tenantId: input.tenantId,
    ...(input.batchSize === undefined ? {} : { batchSize: input.batchSize }),
    leaseSeconds,
    maxAttempts,
    now: now(),
  });

  let published = 0;
  let failed = 0;
  let dead = 0;
  let claimLost = 0;

  for (const item of claimed) {
    try {
      await input.publisher.publish({
        item,
        renewLease: async (renewSeconds = leaseSeconds) => {
          await extendDomainEventOutboxClaim(client, {
            tenantId: item.tenantId,
            outboxId: item.outboxId,
            claimToken: item.claimToken,
            leaseSeconds: renewSeconds,
            now: now(),
          });
        },
      });

      await publishDomainEventOutboxClaim(client, {
        tenantId: item.tenantId,
        outboxId: item.outboxId,
        claimToken: item.claimToken,
        publishedAt: now(),
      });
      published += 1;
    } catch (error) {
      if (isClaimLost(error)) {
        claimLost += 1;
        continue;
      }

      const message = error instanceof Error ? error.message : 'Unknown outbox handler failure.';
      const retryDelaySeconds = domainEventOutboxRetryDelaySeconds({
        attempts: item.attempts,
        ...(input.baseRetryDelaySeconds === undefined
          ? {}
          : { baseDelaySeconds: input.baseRetryDelaySeconds }),
        ...(input.maxRetryDelaySeconds === undefined
          ? {}
          : { maxDelaySeconds: input.maxRetryDelaySeconds }),
      });

      try {
        const state = await failDomainEventOutboxClaim(client, {
          tenantId: item.tenantId,
          outboxId: item.outboxId,
          claimToken: item.claimToken,
          error: message,
          maxAttempts,
          retryDelaySeconds,
          failedAt: now(),
        });
        if (state === 'DEAD') dead += 1;
        else failed += 1;
      } catch (failError) {
        if (isClaimLost(failError)) {
          claimLost += 1;
          continue;
        }
        throw failError;
      }
    }
  }

  return {
    claimed: claimed.length,
    published,
    failed,
    dead,
    claimLost,
  };
}
