import type { CapabilityAvailabilityRepository } from '@expadio/access-runtime';
import type { ResolvedCapabilityState } from '@expadio/capabilities';
import type { EffectiveContext } from '@expadio/tenancy';
import type { PostgresClient } from './index.ts';

interface CapabilityAvailabilityRow {
  readonly state: ResolvedCapabilityState['state'] | null;
  readonly reason_key: string | null;
  readonly blocking_step_key: string | null;
  readonly blocking_bound_key: string | null;
  readonly if_you_do_nothing: readonly string[] | null;
}

export class PostgresCapabilityAvailabilityRepository
  implements CapabilityAvailabilityRepository
{
  readonly #client: PostgresClient;

  /** The client must already be inside the verified EffectiveContext transaction. */
  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async loadCapabilityState(
    context: EffectiveContext,
    capabilityKey: string,
  ): Promise<ResolvedCapabilityState | null> {
    const result = await this.#client.query<CapabilityAvailabilityRow>(
      `SELECT
         s.state,
         s.reason_key,
         s.blocking_step_key,
         s.blocking_bound_key,
         s.if_you_do_nothing
       FROM platform.tenant_capability_bindings b
       JOIN platform.capabilities c ON c.capability_id = b.capability_id
       LEFT JOIN platform.capability_state s ON s.binding_id = b.binding_id
       WHERE b.tenant_id = $1::uuid
         AND c.capability_key = $2
         AND c.enabled = true
         AND (b.organization_id = $3::uuid OR b.organization_id IS NULL)
       ORDER BY CASE WHEN b.organization_id = $3::uuid THEN 0 ELSE 1 END
       LIMIT 1`,
      [context.tenantId, capabilityKey, context.organizationId],
    );

    const row = result.rows[0];
    if (row === undefined) return null;

    if (row.state === null) {
      return {
        state: 'NOT_CONFIGURED',
        reasonKey: 'CAPABILITY_STATE_NOT_RESOLVED',
        blockingStepKey: 'RESOLVE_CAPABILITY_STATE',
        blockingBoundKey: null,
        ifYouDoNothing: [
          'The capability remains unavailable until its persisted state has been resolved.',
        ],
      };
    }

    return {
      state: row.state,
      reasonKey: row.reason_key,
      blockingStepKey: row.blocking_step_key,
      blockingBoundKey: row.blocking_bound_key,
      ifYouDoNothing: [...(row.if_you_do_nothing ?? [])],
    };
  }
}
