import type {
  CreateIndustryPackDraft,
  IndustryPack,
  IndustryPackAuthoringScope,
  IndustryPackVersion,
  IndustryPackVersionIdentity,
  IndustryPackVersionRepository,
  IndustryPackLifecycleRepository,
  IndustryPackVersionSource,
  IndustryPackVersionState,
  UpdateIndustryPackDraft,
} from '@expadio/industry-packs';
import type { PostgresClient } from './index.ts';

interface IndustryPackVersionRow {
  readonly tenant_id: string | null;
  readonly vertical_key: string;
  readonly version: number;
  readonly source: IndustryPackVersionSource;
  readonly state: IndustryPackVersionState;
  readonly revision: number;
  readonly definition: IndustryPack;
  readonly parent_vertical_key: string | null;
  readonly parent_version: number | null;
  readonly created_by_subject_id: string;
  readonly created_at: Date | string;
  readonly updated_by_subject_id: string;
  readonly updated_at: Date | string;
  readonly submitted_by_subject_id: string | null;
  readonly submitted_at: Date | string | null;
  readonly published_by_subject_id: string | null;
  readonly published_at: Date | string | null;
}

const SELECT_COLUMNS = `tenant_id, vertical_key, version, source, state, revision,
  definition, parent_vertical_key, parent_version,
  created_by_subject_id, created_at, updated_by_subject_id, updated_at,
  submitted_by_subject_id, submitted_at, published_by_subject_id, published_at`;

/**
 * SQL adapter for authored Industry Pack versions.
 *
 * Tenant callers must already have transaction-local tenant RLS context bound.
 * Platform-authoring calls require the privileged platform control-plane DB role.
 */
export class PostgresIndustryPackVersionRepository
  implements IndustryPackVersionRepository, IndustryPackLifecycleRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async createDraft(input: CreateIndustryPackDraft): Promise<IndustryPackVersion> {
    const tenantId = scopeTenantId(input.scope);
    const source: IndustryPackVersionSource =
      input.scope.type === 'PLATFORM' ? 'PLATFORM_AUTHORED' : 'TENANT_AUTHORED';

    const result = await this.#client.query<IndustryPackVersionRow>(
      `WITH next_version AS (
         SELECT COALESCE(MAX(version), 0) + 1 AS version
           FROM platform.industry_pack_versions
          WHERE lower(vertical_key) = lower($2)
            AND (
              ($1::uuid IS NULL AND tenant_id IS NULL)
              OR tenant_id = $1::uuid
            )
       )
       INSERT INTO platform.industry_pack_versions (
         tenant_id, vertical_key, version, source, state, revision, definition,
         parent_vertical_key, parent_version,
         created_by_subject_id, updated_by_subject_id
       )
       SELECT $1::uuid, $2, next_version.version, $3, 'DRAFT', 1, $4::jsonb,
              $5, $6, $7, $7
         FROM next_version
       RETURNING ${SELECT_COLUMNS}`,
      [
        tenantId,
        input.verticalKey.trim().toLowerCase(),
        source,
        JSON.stringify(input.definition),
        input.parent?.verticalKey ?? null,
        input.parent?.version ?? null,
        input.createdBySubjectId,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) throw new Error('INDUSTRY_PACK_DRAFT_CREATE_FAILED');
    return mapRow(row);
  }

  async updateDraft(input: UpdateIndustryPackDraft): Promise<IndustryPackVersion> {
    const tenantId = scopeTenantId(input.scope);
    const result = await this.#client.query<IndustryPackVersionRow>(
      `UPDATE platform.industry_pack_versions
          SET definition = $4::jsonb,
              revision = revision + 1,
              updated_by_subject_id = $5,
              updated_at = now()
        WHERE lower(vertical_key) = lower($2)
          AND version = $3
          AND state = 'DRAFT'
          AND revision = $6
          AND (
            ($1::uuid IS NULL AND tenant_id IS NULL)
            OR tenant_id = $1::uuid
          )
       RETURNING ${SELECT_COLUMNS}`,
      [
        tenantId,
        input.identity.verticalKey,
        input.identity.version,
        JSON.stringify(input.definition),
        input.updatedBySubjectId,
        input.expectedRevision,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) throw new Error('INDUSTRY_PACK_DRAFT_UPDATE_CONFLICT');
    return mapRow(row);
  }

  async findByIdentity(input: {
    readonly scope: IndustryPackAuthoringScope;
    readonly identity: IndustryPackVersionIdentity;
  }): Promise<IndustryPackVersion | null> {
    const tenantId = scopeTenantId(input.scope);
    const result = await this.#client.query<IndustryPackVersionRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.industry_pack_versions
        WHERE lower(vertical_key) = lower($2)
          AND version = $3
          AND (
            ($1::uuid IS NULL AND tenant_id IS NULL)
            OR tenant_id = $1::uuid
          )
        LIMIT 1`,
      [tenantId, input.identity.verticalKey, input.identity.version],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRow(row);
  }

  async listVersions(input: {
    readonly scope: IndustryPackAuthoringScope;
    readonly verticalKey: string;
  }): Promise<readonly IndustryPackVersion[]> {
    const tenantId = scopeTenantId(input.scope);
    const result = await this.#client.query<IndustryPackVersionRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM platform.industry_pack_versions
        WHERE lower(vertical_key) = lower($2)
          AND (
            ($1::uuid IS NULL AND tenant_id IS NULL)
            OR tenant_id = $1::uuid
          )
        ORDER BY version DESC`,
      [tenantId, input.verticalKey],
    );
    return result.rows.map(mapRow);
  }

  async transitionLifecycle(input: {
    readonly scope: IndustryPackAuthoringScope;
    readonly identity: IndustryPackVersionIdentity;
    readonly expectedState: IndustryPackVersionState;
    readonly next: IndustryPackVersion;
  }): Promise<IndustryPackVersion> {
    const tenantId = scopeTenantId(input.scope);
    const result = await this.#client.query<IndustryPackVersionRow>(
      `UPDATE platform.industry_pack_versions
          SET state = $4,
              updated_by_subject_id = $5,
              updated_at = $6::timestamptz,
              submitted_by_subject_id = $7,
              submitted_at = $8::timestamptz,
              published_by_subject_id = $9,
              published_at = $10::timestamptz
        WHERE lower(vertical_key) = lower($2)
          AND version = $3
          AND state = $11
          AND (
            ($1::uuid IS NULL AND tenant_id IS NULL)
            OR tenant_id = $1::uuid
          )
       RETURNING ${SELECT_COLUMNS}`,
      [
        tenantId,
        input.identity.verticalKey,
        input.identity.version,
        input.next.state,
        input.next.updatedBySubjectId,
        input.next.updatedAt,
        input.next.submittedBySubjectId ?? null,
        input.next.submittedAt ?? null,
        input.next.publishedBySubjectId ?? null,
        input.next.publishedAt ?? null,
        input.expectedState,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) throw new Error('INDUSTRY_PACK_LIFECYCLE_TRANSITION_CONFLICT');
    return mapRow(row);
  }
}

function scopeTenantId(scope: IndustryPackAuthoringScope): string | null {
  return scope.type === 'TENANT' ? scope.tenantId : null;
}

function mapRow(row: IndustryPackVersionRow): IndustryPackVersion {
  return {
    identity: {
      verticalKey: row.vertical_key,
      version: row.version,
    },
    scope: row.tenant_id === null
      ? { type: 'PLATFORM' }
      : { type: 'TENANT', tenantId: row.tenant_id },
    source: row.source,
    state: row.state,
    definition: structuredClone(row.definition),
    revision: row.revision,
    ...(row.parent_vertical_key === null || row.parent_version === null
      ? {}
      : {
          parent: {
            verticalKey: row.parent_vertical_key,
            version: row.parent_version,
          },
        }),
    createdBySubjectId: row.created_by_subject_id,
    createdAt: toIsoString(row.created_at),
    updatedBySubjectId: row.updated_by_subject_id,
    updatedAt: toIsoString(row.updated_at),
    ...(row.submitted_by_subject_id === null || row.submitted_at === null
      ? {}
      : {
          submittedBySubjectId: row.submitted_by_subject_id,
          submittedAt: toIsoString(row.submitted_at),
        }),
    ...(row.published_by_subject_id === null || row.published_at === null
      ? {}
      : {
          publishedBySubjectId: row.published_by_subject_id,
          publishedAt: toIsoString(row.published_at),
        }),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
