import type {
  EntityReference,
  EntityRelationship,
  RelationshipDefinition,
  RelationshipProvenanceSource,
} from '@expadio/relationship';
import {
  isSingleCardinality,
  validateRelationshipDefinition,
  validateRelationshipTarget,
} from '@expadio/relationship';

export interface EntityRelationshipSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface EntityRelationshipSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<EntityRelationshipSqlResult<Row>>;
}

interface RelationshipRow {
  readonly relationship_id: string;
  readonly tenant_id: string;
  readonly source_entity_type: string;
  readonly source_entity_id: string;
  readonly relationship_key: string;
  readonly target_entity_type: string;
  readonly target_entity_id: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly valid_from: Date | string;
  readonly valid_until: Date | string | null;
  readonly attributes: Record<string, unknown>;
  readonly provenance_source: RelationshipProvenanceSource;
  readonly created_by_subject_id: string;
  readonly updated_by_subject_id: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

export interface RelationshipMutationInput {
  readonly tenantId: string;
  readonly definition: RelationshipDefinition;
  readonly sourceEntityId: string;
  readonly target: EntityReference;
  readonly actorSubjectId: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly provenanceSource?: RelationshipProvenanceSource;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: RelationshipRow): EntityRelationship {
  return {
    relationshipId: row.relationship_id,
    tenantId: row.tenant_id,
    source: {
      entityType: row.source_entity_type,
      entityId: row.source_entity_id,
    },
    relationshipKey: row.relationship_key,
    target: {
      entityType: row.target_entity_type,
      entityId: row.target_entity_id,
    },
    status: row.status,
    validFrom: date(row.valid_from),
    validUntil: row.valid_until === null ? null : date(row.valid_until),
    attributes: row.attributes,
    provenanceSource: row.provenance_source,
    createdBySubjectId: row.created_by_subject_id,
    updatedBySubjectId: row.updated_by_subject_id,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '') throw new Error(`RELATIONSHIP_${field.toUpperCase()}_REQUIRED`);
  return normalized;
}

function lockIdentity(input: {
  readonly tenantId: string;
  readonly sourceEntityType: string;
  readonly sourceEntityId: string;
  readonly relationshipKey: string;
}): string {
  return [
    input.tenantId,
    input.sourceEntityType,
    input.sourceEntityId,
    input.relationshipKey,
  ].join('|');
}

/**
 * PostgreSQL persistence for authoritative business relationships.
 *
 * The caller owns the surrounding transaction. Mutations take a transaction-
 * scoped advisory lock per tenant/source/key so concurrent single-cardinality
 * assignments cannot create two active targets.
 */
export class PostgresEntityRelationshipRepository {
  readonly #client: EntityRelationshipSqlClient;

  constructor(client: EntityRelationshipSqlClient) {
    this.#client = client;
  }

  async listActive(input: {
    readonly tenantId: string;
    readonly sourceEntityType: string;
    readonly sourceEntityId: string;
    readonly relationshipKey?: string;
  }): Promise<readonly EntityRelationship[]> {
    const tenantId = required(input.tenantId, 'tenant_id');
    const sourceEntityType = required(input.sourceEntityType, 'source_entity_type');
    const sourceEntityId = required(input.sourceEntityId, 'source_entity_id');
    const relationshipKey = input.relationshipKey?.trim() || null;

    const result = await this.#client.query<RelationshipRow>(
      `SELECT relationship_id, tenant_id, source_entity_type, source_entity_id,
              relationship_key, target_entity_type, target_entity_id, status,
              valid_from, valid_until, attributes, provenance_source,
              created_by_subject_id, updated_by_subject_id, created_at, updated_at
         FROM platform.entity_relationships
        WHERE tenant_id = $1::uuid
          AND source_entity_type = $2
          AND source_entity_id = $3
          AND status = 'ACTIVE'
          AND valid_until IS NULL
          AND ($4::text IS NULL OR relationship_key = $4)
        ORDER BY relationship_key, valid_from, relationship_id`,
      [tenantId, sourceEntityType, sourceEntityId, relationshipKey],
    );
    return result.rows.map(mapRow);
  }

  async listHistory(input: {
    readonly tenantId: string;
    readonly sourceEntityType: string;
    readonly sourceEntityId: string;
    readonly relationshipKey: string;
  }): Promise<readonly EntityRelationship[]> {
    const result = await this.#client.query<RelationshipRow>(
      `SELECT relationship_id, tenant_id, source_entity_type, source_entity_id,
              relationship_key, target_entity_type, target_entity_id, status,
              valid_from, valid_until, attributes, provenance_source,
              created_by_subject_id, updated_by_subject_id, created_at, updated_at
         FROM platform.entity_relationships
        WHERE tenant_id = $1::uuid
          AND source_entity_type = $2
          AND source_entity_id = $3
          AND relationship_key = $4
        ORDER BY valid_from, relationship_id`,
      [
        required(input.tenantId, 'tenant_id'),
        required(input.sourceEntityType, 'source_entity_type'),
        required(input.sourceEntityId, 'source_entity_id'),
        required(input.relationshipKey, 'relationship_key'),
      ],
    );
    return result.rows.map(mapRow);
  }

  async add(input: RelationshipMutationInput): Promise<EntityRelationship> {
    const definition = validateRelationshipDefinition(input.definition);
    const tenantId = required(input.tenantId, 'tenant_id');
    const sourceEntityId = required(input.sourceEntityId, 'source_entity_id');
    const actorSubjectId = required(input.actorSubjectId, 'actor_subject_id');
    const target = validateRelationshipTarget(definition, input.target);

    await this.#client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [lockIdentity({
        tenantId,
        sourceEntityType: definition.sourceEntityType,
        sourceEntityId,
        relationshipKey: definition.key,
      })],
    );

    const existing = await this.listActive({
      tenantId,
      sourceEntityType: definition.sourceEntityType,
      sourceEntityId,
      relationshipKey: definition.key,
    });
    const exact = existing.find(
      (relationship) =>
        relationship.target.entityType === target.entityType
        && relationship.target.entityId === target.entityId,
    );
    if (exact !== undefined) return exact;

    if (isSingleCardinality(definition.cardinality) && existing.length > 0) {
      throw new Error('RELATIONSHIP_CARDINALITY_VIOLATION');
    }

    return this.#insert({
      tenantId,
      definition,
      sourceEntityId,
      target,
      actorSubjectId,
      attributes: input.attributes ?? {},
      provenanceSource: input.provenanceSource ?? 'USER',
    });
  }

  async replaceSingle(input: RelationshipMutationInput): Promise<EntityRelationship> {
    const definition = validateRelationshipDefinition(input.definition);
    if (!isSingleCardinality(definition.cardinality)) {
      throw new Error('RELATIONSHIP_REPLACE_REQUIRES_SINGLE_CARDINALITY');
    }

    const tenantId = required(input.tenantId, 'tenant_id');
    const sourceEntityId = required(input.sourceEntityId, 'source_entity_id');
    const actorSubjectId = required(input.actorSubjectId, 'actor_subject_id');
    const target = validateRelationshipTarget(definition, input.target);

    await this.#client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [lockIdentity({
        tenantId,
        sourceEntityType: definition.sourceEntityType,
        sourceEntityId,
        relationshipKey: definition.key,
      })],
    );

    const existing = await this.listActive({
      tenantId,
      sourceEntityType: definition.sourceEntityType,
      sourceEntityId,
      relationshipKey: definition.key,
    });
    const exact = existing.find(
      (relationship) =>
        relationship.target.entityType === target.entityType
        && relationship.target.entityId === target.entityId,
    );
    if (exact !== undefined) return exact;

    await this.#client.query(
      `UPDATE platform.entity_relationships
          SET status = 'INACTIVE',
              valid_until = clock_timestamp(),
              updated_by_subject_id = $5,
              updated_at = clock_timestamp()
        WHERE tenant_id = $1::uuid
          AND source_entity_type = $2
          AND source_entity_id = $3
          AND relationship_key = $4
          AND status = 'ACTIVE'
          AND valid_until IS NULL`,
      [
        tenantId,
        definition.sourceEntityType,
        sourceEntityId,
        definition.key,
        actorSubjectId,
      ],
    );

    return this.#insert({
      tenantId,
      definition,
      sourceEntityId,
      target,
      actorSubjectId,
      attributes: input.attributes ?? {},
      provenanceSource: input.provenanceSource ?? 'USER',
    });
  }

  async #insert(input: {
    readonly tenantId: string;
    readonly definition: RelationshipDefinition;
    readonly sourceEntityId: string;
    readonly target: EntityReference;
    readonly actorSubjectId: string;
    readonly attributes: Readonly<Record<string, unknown>>;
    readonly provenanceSource: RelationshipProvenanceSource;
  }): Promise<EntityRelationship> {
    const result = await this.#client.query<RelationshipRow>(
      `INSERT INTO platform.entity_relationships (
         tenant_id, source_entity_type, source_entity_id, relationship_key,
         target_entity_type, target_entity_id, status, valid_from, attributes,
         provenance_source, created_by_subject_id
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, 'ACTIVE', clock_timestamp(), $7::jsonb, $8, $9
       )
       RETURNING relationship_id, tenant_id, source_entity_type, source_entity_id,
                 relationship_key, target_entity_type, target_entity_id, status,
                 valid_from, valid_until, attributes, provenance_source,
                 created_by_subject_id, updated_by_subject_id, created_at, updated_at`,
      [
        input.tenantId,
        input.definition.sourceEntityType,
        input.sourceEntityId,
        input.definition.key,
        input.target.entityType,
        input.target.entityId,
        JSON.stringify(input.attributes),
        input.provenanceSource,
        input.actorSubjectId,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('RELATIONSHIP_INSERT_FAILED');
    return mapRow(row);
  }
}
