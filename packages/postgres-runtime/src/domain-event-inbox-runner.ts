import type {
  ClaimedDomainEventInboxItem,
  DomainEventInboxSqlClient,
} from './domain-event-inbox.ts';
import {
  claimDomainEventInboxBatch,
  extendDomainEventInboxClaim,
  failDomainEventInboxClaim,
  processDomainEventInboxClaim,
} from './domain-event-inbox.ts';
import { domainEventOutboxRetryDelaySeconds } from './domain-event-outbox-runner.ts';

export interface DomainEventConsumerContext {
  readonly item: ClaimedDomainEventInboxItem;
  readonly renewLease: (leaseSeconds?: number) => Promise<void>;
}

export interface DomainEventConsumer {
  consume(context: DomainEventConsumerContext): Promise<void>;
}

export interface DomainEventInboxBatchRunResult {
  readonly claimed: number;
  readonly processed: number;
  readonly failed: number;
  readonly dead: number;
  readonly claimLost: number;
}

function isClaimLost(error: unknown): boolean {
  return error instanceof Error && error.message === 'DOMAIN_EVENT_INBOX_CLAIM_LOST';
}

/**
 * Process one tenant + consumer inbox batch.
 *
 * Consumer side effects must be idempotent: the process can crash after a
 * consumer commits but before the inbox row becomes PROCESSED. Deterministic
 * Action Intent and Communications idempotency keys provide this guarantee for
 * the governed-action consumer.
 */
export async function runDomainEventInboxBatch(
  client: DomainEventInboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly consumerKey: string;
    readonly consumer: DomainEventConsumer;
    readonly batchSize?: number;
    readonly leaseSeconds?: number;
    readonly maxAttempts?: number;
    readonly baseRetryDelaySeconds?: number;
    readonly maxRetryDelaySeconds?: number;
    readonly now?: () => Date;
  },
): Promise<DomainEventInboxBatchRunResult> {
  const now = input.now ?? (() => new Date());
  const leaseSeconds = input.leaseSeconds ?? 60;
  const maxAttempts = input.maxAttempts ?? 8;

  const claimed = await claimDomainEventInboxBatch(client, {
    tenantId: input.tenantId,
    consumerKey: input.consumerKey,
    ...(input.batchSize === undefined ? {} : { batchSize: input.batchSize }),
    leaseSeconds,
    maxAttempts,
    now: now(),
  });

  let processed = 0;
  let failed = 0;
  let dead = 0;
  let claimLost = 0;

  for (const item of claimed) {
    try {
      await input.consumer.consume({
        item,
        renewLease: async (renewSeconds = leaseSeconds) => {
          await extendDomainEventInboxClaim(client, {
            tenantId: item.tenantId,
            inboxId: item.inboxId,
            claimToken: item.claimToken,
            leaseSeconds: renewSeconds,
            now: now(),
          });
        },
      });

      await processDomainEventInboxClaim(client, {
        tenantId: item.tenantId,
        inboxId: item.inboxId,
        claimToken: item.claimToken,
        processedAt: now(),
      });
      processed += 1;
    } catch (error) {
      if (isClaimLost(error)) {
        claimLost += 1;
        continue;
      }

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
        const state = await failDomainEventInboxClaim(client, {
          tenantId: item.tenantId,
          inboxId: item.inboxId,
          claimToken: item.claimToken,
          error: error instanceof Error ? error.message : 'Unknown consumer failure.',
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
    processed,
    failed,
    dead,
    claimLost,
  };
}
