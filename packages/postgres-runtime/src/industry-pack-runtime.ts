import {
  findIndustryPack,
  IndustryPackRuntimeResolutionError,
  type IndustryPack,
  type IndustryPackRuntimeResolveInput,
  type IndustryPackRuntimeResolution,
  type IndustryPackRuntimeResolver,
} from '@expadio/industry-packs';
import type { PostgresClient } from './index.ts';

interface PublishedPackRow {
  readonly tenant_id: string | null;
  readonly vertical_key: string;
  readonly version: number;
  readonly definition: IndustryPack;
}

export class PostgresIndustryPackRuntimeResolver implements IndustryPackRuntimeResolver {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolve(input: IndustryPackRuntimeResolveInput): Promise<IndustryPackRuntimeResolution> {
    const verticalKey = input.verticalKey?.trim().toLowerCase() ?? null;

    if (verticalKey === null || verticalKey === '') {
      return {
        pack: null,
        provenance: {
          verticalKey: null,
          version: null,
          source: 'NEUTRAL',
          scope: 'NONE',
        },
        precedenceTrace: ['tenant-binding:none', 'neutral-engine'],
      };
    }

    const tenantPublished = await this.#loadPublished({
      tenantId: input.tenantId,
      verticalKey,
    });
    if (tenantPublished !== null) {
      return {
        pack: structuredClone(tenantPublished.definition),
        provenance: {
          verticalKey,
          version: tenantPublished.version,
          source: 'TENANT_PUBLISHED',
          scope: 'TENANT',
        },
        precedenceTrace: ['tenant-published'],
      };
    }

    const platformPublished = await this.#loadPublished({
      tenantId: null,
      verticalKey,
    });
    if (platformPublished !== null) {
      return {
        pack: structuredClone(platformPublished.definition),
        provenance: {
          verticalKey,
          version: platformPublished.version,
          source: 'PLATFORM_PUBLISHED',
          scope: 'PLATFORM',
        },
        precedenceTrace: ['tenant-published:none', 'platform-published'],
      };
    }

    const baseline = findIndustryPack(verticalKey);
    if (baseline !== null) {
      return {
        pack: baseline,
        provenance: {
          verticalKey,
          version: null,
          source: 'CODE_BASELINE',
          scope: 'CODE',
        },
        precedenceTrace: [
          'tenant-published:none',
          'platform-published:none',
          'code-baseline',
        ],
      };
    }

    throw new IndustryPackRuntimeResolutionError(
      `No executable Industry Pack exists for vertical "${verticalKey}".`,
    );
  }

  async #loadPublished(input: {
    readonly tenantId: string | null;
    readonly verticalKey: string;
  }): Promise<PublishedPackRow | null> {
    const result = await this.#client.query<PublishedPackRow>(
      `SELECT tenant_id, vertical_key, version, definition
         FROM platform.industry_pack_versions
        WHERE lower(vertical_key) = $2
          AND state = 'PUBLISHED'
          AND (
            ($1::uuid IS NULL AND tenant_id IS NULL)
            OR tenant_id = $1::uuid
          )
        LIMIT 1`,
      [input.tenantId, input.verticalKey],
    );

    return result.rows[0] ?? null;
  }
}
