import type {
  BusinessConfigurationIdentity,
  BusinessConfigurationObject,
  BusinessConfigurationPublication,
  BusinessConfigurationPublicationCommitResult,
  BusinessConfigurationPublicationRepository,
  BusinessConfigurationScope,
} from '@expadio/business-config';
import type { PostgresClient } from './index.ts';

interface PublicationRow {
  readonly changeset_id: string;
  readonly scope_kind: 'PLATFORM' | 'VERTICAL' | 'TENANT';
  readonly scope_key: string | null;
  readonly tenant_id: string | null;
  readonly base_revision: number;
  readonly revision: number;
  readonly published_by_subject_id: string;
  readonly published_at: Date | string;
  readonly reason: string;
  readonly evidence_refs: readonly string[];
}

interface ObjectRow {
  readonly kind: BusinessConfigurationObject['kind'];
  readonly object_key: string;
  readonly version: number;
  readonly label: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dependencies: readonly BusinessConfigurationIdentity[];
  readonly authored_by_subject_id: string;
  readonly authored_at: Date | string;
}

interface IdentityRow {
  readonly kind: BusinessConfigurationIdentity['kind'];
  readonly object_key: string;
  readonly version: number;
}

interface RevisionRow {
  readonly revision: number;
}

/** PostgreSQL adapter for atomic, immutable configuration publications. */
export class PostgresBusinessConfigurationPublicationRepository
  implements BusinessConfigurationPublicationRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async listAvailableIdentities(
    scope: BusinessConfigurationScope,
  ): Promise<readonly BusinessConfigurationIdentity[]> {
    const parts = scopeParts(scope);
    const result = await this.#client.query<IdentityRow>(
      `SELECT DISTINCT kind, object_key, version
         FROM platform.business_configuration_objects
        WHERE scope_kind = 'PLATFORM'
           OR (scope_kind = $1 AND COALESCE(scope_key, '') = COALESCE($2, ''))`,
      [parts.kind, parts.key],
    );
    return result.rows.map((row) => ({
      kind: row.kind,
      key: row.object_key,
      version: row.version,
    }));
  }

  async findPublication(input: {
    readonly scope: BusinessConfigurationScope;
    readonly changesetId: string;
  }): Promise<BusinessConfigurationPublication | null> {
    const parts = scopeParts(input.scope);
    const publicationResult = await this.#client.query<PublicationRow>(
      `SELECT changeset_id, scope_kind, scope_key, tenant_id, base_revision,
              revision, published_by_subject_id, published_at, reason, evidence_refs
         FROM platform.business_configuration_publications
        WHERE scope_kind = $1
          AND COALESCE(scope_key, '') = COALESCE($2, '')
          AND changeset_id = $3::uuid
        LIMIT 1`,
      [parts.kind, parts.key, input.changesetId],
    );
    const row = publicationResult.rows[0];
    if (row === undefined) return null;

    const objectResult = await this.#client.query<ObjectRow>(
      `SELECT kind, object_key, version, label, payload, dependencies,
              authored_by_subject_id, authored_at
         FROM platform.business_configuration_objects
        WHERE publication_id = (
          SELECT publication_id
            FROM platform.business_configuration_publications
           WHERE scope_kind = $1
             AND COALESCE(scope_key, '') = COALESCE($2, '')
             AND changeset_id = $3::uuid
        )
        ORDER BY kind, object_key, version`,
      [parts.kind, parts.key, input.changesetId],
    );
    const scope = mapScope(row);
    return {
      changesetId: row.changeset_id,
      scope,
      baseRevision: row.base_revision,
      revision: row.revision,
      objects: objectResult.rows.map((object) => mapObject(object, scope)),
      publishedBySubjectId: row.published_by_subject_id,
      publishedAt: iso(row.published_at),
      reason: row.reason,
      evidenceRefs: [...row.evidence_refs],
    };
  }

  async publish(
    publication: BusinessConfigurationPublication,
  ): Promise<BusinessConfigurationPublicationCommitResult> {
    const parts = scopeParts(publication.scope);
    try {
      const result = await this.#client.query(
        `WITH inserted_publication AS (
           INSERT INTO platform.business_configuration_publications (
             publication_id, changeset_id, scope_kind, scope_key, tenant_id,
             base_revision, revision, published_by_subject_id, published_at,
             reason, evidence_refs
           ) VALUES (
             gen_random_uuid(), $1::uuid, $2, $3, $4::uuid,
             $5, $6, $7, $8::timestamptz, $9, $10::text[]
           )
           ON CONFLICT DO NOTHING
           RETURNING publication_id
         ),
         object_input AS (
           SELECT *
             FROM jsonb_to_recordset($11::jsonb) AS object_record(
               kind text, object_key text, version integer, label text,
               payload jsonb, dependencies jsonb,
               authored_by_subject_id text, authored_at timestamptz
             )
         )
         INSERT INTO platform.business_configuration_objects (
           object_id, publication_id, scope_kind, scope_key, tenant_id,
           kind, object_key, version, label, payload, dependencies,
           authored_by_subject_id, authored_at
         )
         SELECT gen_random_uuid(), inserted_publication.publication_id,
                $2, $3, $4::uuid, object_input.kind, object_input.object_key,
                object_input.version, object_input.label, object_input.payload,
                object_input.dependencies, object_input.authored_by_subject_id,
                object_input.authored_at
           FROM inserted_publication
           CROSS JOIN object_input`,
        [
          publication.changesetId,
          parts.kind,
          parts.key,
          parts.tenantId,
          publication.baseRevision,
          publication.revision,
          publication.publishedBySubjectId,
          publication.publishedAt,
          publication.reason,
          [...publication.evidenceRefs],
          JSON.stringify(publication.objects.map((object) => ({
            kind: object.kind,
            object_key: object.key,
            version: object.version,
            label: object.label,
            payload: object.payload,
            dependencies: object.dependencies,
            authored_by_subject_id: object.authoredBySubjectId,
            authored_at: object.authoredAt,
          }))),
        ],
      );
      if (result.rowCount !== 0) {
        return { status: 'COMMITTED', publication };
      }
    } catch (error) {
      if (postgresErrorCode(error) !== '40001') throw error;
      const currentRevision = await this.currentRevision(publication.scope);
      return { status: 'REVISION_CONFLICT', currentRevision };
    }

    const existing = await this.findPublication({
      scope: publication.scope,
      changesetId: publication.changesetId,
    });
    if (existing === null) {
      throw new Error('BUSINESS_CONFIGURATION_CONFLICT_WITHOUT_PUBLICATION');
    }
    return samePublication(existing, publication)
      ? { status: 'ALREADY_COMMITTED', publication: existing }
      : { status: 'CHANGESET_CONFLICT', existing };
  }

  private async currentRevision(scope: BusinessConfigurationScope): Promise<number> {
    const parts = scopeParts(scope);
    const result = await this.#client.query<RevisionRow>(
      `SELECT COALESCE(max(revision), 0)::integer AS revision
         FROM platform.business_configuration_publications
        WHERE scope_kind = $1
          AND COALESCE(scope_key, '') = COALESCE($2, '')`,
      [parts.kind, parts.key],
    );
    return result.rows[0]?.revision ?? 0;
  }
}

function scopeParts(scope: BusinessConfigurationScope): {
  readonly kind: BusinessConfigurationScope['kind'];
  readonly key: string | null;
  readonly tenantId: string | null;
} {
  switch (scope.kind) {
    case 'PLATFORM':
      return { kind: scope.kind, key: null, tenantId: null };
    case 'VERTICAL':
      return { kind: scope.kind, key: scope.verticalKey, tenantId: null };
    case 'TENANT':
      return { kind: scope.kind, key: scope.tenantId, tenantId: scope.tenantId };
  }
}

function mapScope(row: PublicationRow): BusinessConfigurationScope {
  if (row.scope_kind === 'PLATFORM') return { kind: 'PLATFORM' };
  if (row.scope_kind === 'VERTICAL') {
    return { kind: 'VERTICAL', verticalKey: row.scope_key! };
  }
  return { kind: 'TENANT', tenantId: row.tenant_id! };
}

function mapObject(
  row: ObjectRow,
  scope: BusinessConfigurationScope,
): BusinessConfigurationObject {
  return {
    kind: row.kind,
    key: row.object_key,
    version: row.version,
    scope,
    label: row.label,
    state: 'PUBLISHED',
    payload: row.payload,
    dependencies: row.dependencies.map((dependency) => ({ ...dependency })),
    authoredBySubjectId: row.authored_by_subject_id,
    authoredAt: iso(row.authored_at),
  };
}

function samePublication(
  left: BusinessConfigurationPublication,
  right: BusinessConfigurationPublication,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
