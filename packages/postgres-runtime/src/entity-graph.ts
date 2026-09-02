export interface EntityGraphSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface EntityGraphSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<EntityGraphSqlResult<Row>>;
}

export interface PublishGovernedRelationshipInput {
  readonly tenantId: string;
  readonly sourceEntityType: string;
  readonly sourceEntityId: string;
  readonly relationshipKey: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string;
  readonly actorSubjectId: string;
  readonly provenanceSource?: 'USER' | 'SYSTEM' | 'PACK' | 'IMPORT' | 'INTEGRATION';
  readonly validFrom?: Date | string | null;
  readonly validUntil?: Date | string | null;
  readonly agreementReference?: string | null;
  readonly decisionReference?: string | null;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Publishes a derived relationship projection inside the caller-owned
 * transaction. The database function owns registry validation, cardinality,
 * advisory locking and exact-edge idempotency.
 */
export async function publishGovernedEntityRelationship(
  client: EntityGraphSqlClient,
  input: PublishGovernedRelationshipInput,
): Promise<string> {
  const result = await client.query<{ readonly relationship_id: string }>(
    `SELECT platform.create_governed_entity_relationship(
       $1::uuid,
       $2::text,
       $3::text,
       $4::text,
       $5::text,
       $6::text,
       $7::text,
       $8::text,
       COALESCE($9::timestamptz, now()),
       $10::timestamptz,
       $11::text,
       $12::text,
       $13::jsonb
     ) AS relationship_id`,
    [
      input.tenantId,
      input.sourceEntityType,
      input.sourceEntityId,
      input.relationshipKey,
      input.targetEntityType,
      input.targetEntityId,
      input.actorSubjectId,
      input.provenanceSource ?? 'SYSTEM',
      iso(input.validFrom),
      iso(input.validUntil),
      input.agreementReference ?? null,
      input.decisionReference ?? null,
      JSON.stringify(input.attributes ?? {}),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTITY_GRAPH_PUBLICATION_FAILED');
  return row.relationship_id;
}
