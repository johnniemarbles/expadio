import type {
  CommunicationSenderRepository,
  CommunicationSenderResolution,
  CommunicationSenderResolutionInput,
} from '@expadio/communication/sender';
import type { CacheStore } from './cache.ts';

/**
 * Wraps a CommunicationSenderRepository with in-memory caching.
 *
 * **Performance Impact:** Cached sender lookups eliminate repeated queries
 * on high-volume communication dispatch (common case: same sender used for
 * multiple messages in a workflow).
 *
 * **TTL:** 10 minutes by default. Adjust based on sender configuration mutation frequency.
 */
export class CachedCommunicationSenderRepository
  implements CommunicationSenderRepository {
  readonly #repository: CommunicationSenderRepository;
  readonly #cache: CacheStore;
  readonly #ttlMs: number;

  constructor(
    repository: CommunicationSenderRepository,
    cache: CacheStore,
    ttlMs = 10 * 60 * 1000, // 10 minutes
  ) {
    this.#repository = repository;
    this.#cache = cache;
    this.#ttlMs = ttlMs;
  }

  async resolveVerifiedDefault(
    input: CommunicationSenderResolutionInput,
  ): Promise<CommunicationSenderResolution> {
    const cacheKey = this.#buildKey(
      input.tenantId,
      input.organizationId,
      input.channel,
      input.purpose,
    );

    const cached = this.#cache.get<CommunicationSenderResolution>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const result = await this.#repository.resolveVerifiedDefault(input);
    this.#cache.set(cacheKey, result, this.#ttlMs);
    return result;
  }

  /**
   * Invalidate senders by tenant when configuration changes.
   */
  invalidateByTenant(tenantId: string): void {
    this.#cache.invalidate(`sender:${tenantId}`);
  }

  invalidateByOrganization(tenantId: string, organizationId: string): void {
    this.#cache.invalidate(`sender:${tenantId}:${organizationId}`);
  }

  #buildKey(
    tenantId: string,
    organizationId: string | undefined,
    channel: string,
    purpose: string,
  ): string {
    const org = organizationId ?? '__none__';
    return `sender:${tenantId}:${org}:${channel}:${purpose}`;
  }
}
