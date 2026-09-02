import { randomUUID } from 'node:crypto';
import { appendDomainEventWithOutbox } from './domain-events.ts';

export interface EnterpriseLegalSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface EnterpriseLegalSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<EnterpriseLegalSqlResult<Row>>;
}

export interface EnterpriseLegalEntityMatch {
  readonly legalEntityId: string;
  readonly legalName: string;
  readonly entityType: string;
  readonly countryCode: string;
  readonly subdivisionCode: string | null;
  readonly status: string;
  readonly registrationIdentifierId: string | null;
  readonly registrationType: string | null;
  readonly registrationValue: string | null;
  readonly registrationVerificationStatus: string | null;
}

function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function searchEnterpriseLegalEntities(
  client: EnterpriseLegalSqlClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly query: string;
  },
): Promise<readonly EnterpriseLegalEntityMatch[]> {
  const query = input.query.trim();
  if (!query) return [];
  const normalized = normalizeIdentifier(query);
  const result = await client.query<{
    legal_entity_id: string;
    legal_name: string;
    entity_type: string;
    jurisdiction_country_code: string;
    jurisdiction_subdivision_code: string | null;
    status: string;
    registration_identifier_id: string | null;
    identifier_type: string | null;
    identifier_value: string | null;
    verification_status: string | null;
  }>(
    `SELECT
       entity.legal_entity_id,
       entity.legal_name,
       entity.entity_type,
       entity.jurisdiction_country_code,
       entity.jurisdiction_subdivision_code,
       entity.status,
       registration.registration_identifier_id,
       registration.identifier_type,
       registration.identifier_value,
       registration.verification_status
     FROM platform.legal_entities entity
     LEFT JOIN platform.legal_entity_registration_identifiers registration
       ON registration.tenant_id = entity.tenant_id
      AND registration.legal_entity_id = entity.legal_entity_id
      AND registration.valid_until IS NULL
      AND registration.verification_status <> 'REVOKED'
     WHERE entity.tenant_id = $1::uuid
       AND entity.enterprise_id = $2::uuid
       AND entity.status <> 'INACTIVE'
       AND (
         entity.legal_name ILIKE '%' || $3 || '%'
         OR registration.normalized_identifier = $4
         OR registration.identifier_value ILIKE '%' || $3 || '%'
       )
     ORDER BY
       CASE WHEN registration.normalized_identifier = $4 THEN 0 ELSE 1 END,
       entity.legal_name,
       entity.legal_entity_id
     LIMIT 25`,
    [input.tenantId, input.enterpriseId, query, normalized],
  );
  return result.rows.map((row) => ({
    legalEntityId: row.legal_entity_id,
    legalName: row.legal_name,
    entityType: row.entity_type,
    countryCode: row.jurisdiction_country_code,
    subdivisionCode: row.jurisdiction_subdivision_code,
    status: row.status,
    registrationIdentifierId: row.registration_identifier_id,
    registrationType: row.identifier_type,
    registrationValue: row.identifier_value,
    registrationVerificationStatus: row.verification_status,
  }));
}

export async function createEnterpriseLegalEntityIntake(
  client: EnterpriseLegalSqlClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly legalName: string;
    readonly entityType: string;
    readonly countryCode: string;
    readonly subdivisionCode?: string | null;
    readonly registrationJurisdictionCode: string;
    readonly registrationType: string;
    readonly registrationValue: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly legalEntityId: string; readonly idempotent: boolean }> {
  const legalName = input.legalName.trim();
  const countryCode = input.countryCode.trim().toUpperCase();
  const registrationJurisdictionCode = input.registrationJurisdictionCode.trim().toUpperCase();
  const registrationType = input.registrationType.trim().toUpperCase();
  const registrationValue = input.registrationValue.trim();
  const normalizedIdentifier = normalizeIdentifier(registrationValue);

  if (!legalName) throw new Error('ENTERPRISE_LEGAL_ENTITY_NAME_REQUIRED');
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('ENTERPRISE_LEGAL_ENTITY_COUNTRY_INVALID');
  if (!registrationJurisdictionCode || !registrationType || !normalizedIdentifier) {
    throw new Error('ENTERPRISE_LEGAL_ENTITY_REGISTRATION_REQUIRED');
  }

  const existing = await client.query<{
    legal_entity_id: string;
    legal_name: string;
    entity_type: string;
    jurisdiction_country_code: string;
    jurisdiction_subdivision_code: string | null;
    identifier_value: string;
  }>(
    `SELECT
       entity.legal_entity_id,
       entity.legal_name,
       entity.entity_type,
       entity.jurisdiction_country_code,
       entity.jurisdiction_subdivision_code,
       registration.identifier_value
     FROM platform.legal_entity_registration_identifiers registration
     JOIN platform.legal_entities entity
       ON entity.tenant_id = registration.tenant_id
      AND entity.legal_entity_id = registration.legal_entity_id
     WHERE registration.tenant_id = $1::uuid
       AND upper(registration.jurisdiction_code) = $2
       AND upper(registration.identifier_type) = $3
       AND registration.normalized_identifier = $4
       AND registration.verification_status <> 'REVOKED'
       AND registration.valid_until IS NULL
     LIMIT 1
     FOR UPDATE`,
    [
      input.tenantId,
      registrationJurisdictionCode,
      registrationType,
      normalizedIdentifier,
    ],
  );
  const prior = existing.rows[0];
  if (prior) {
    const exact =
      prior.legal_name === legalName
      && prior.entity_type === input.entityType
      && prior.jurisdiction_country_code === countryCode
      && prior.jurisdiction_subdivision_code === (input.subdivisionCode?.trim() || null)
      && prior.identifier_value === registrationValue;
    if (!exact) throw new Error('ENTERPRISE_LEGAL_ENTITY_ALREADY_EXISTS');
    return { legalEntityId: prior.legal_entity_id, idempotent: true };
  }

  const legalEntityId = randomUUID();
  await client.query(
    `INSERT INTO platform.legal_entities (
       legal_entity_id, tenant_id, enterprise_id, legal_name, entity_type,
       jurisdiction_country_code, jurisdiction_subdivision_code, status,
       created_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'VERIFICATION_PENDING', $8
     )`,
    [
      legalEntityId,
      input.tenantId,
      input.enterpriseId,
      legalName,
      input.entityType,
      countryCode,
      input.subdivisionCode?.trim() || null,
      input.actorSubjectId,
    ],
  );
  await client.query(
    `INSERT INTO platform.legal_entity_registration_identifiers (
       registration_identifier_id, tenant_id, legal_entity_id,
       jurisdiction_code, identifier_type, identifier_value,
       normalized_identifier, verification_status, created_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'PENDING', $8
     )`,
    [
      randomUUID(),
      input.tenantId,
      legalEntityId,
      registrationJurisdictionCode,
      registrationType,
      registrationValue,
      normalizedIdentifier,
      input.actorSubjectId,
    ],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'enterprise.legal_entity',
      aggregateId: legalEntityId,
      eventType: 'enterprise.legal_entity.verification_requested',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        enterpriseId: input.enterpriseId,
        legalName,
        countryCode,
        registrationJurisdictionCode,
        registrationType,
      },
    },
  });

  return { legalEntityId, idempotent: false };
}

export async function verifyEnterpriseLegalEntity(
  client: EnterpriseLegalSqlClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly legalEntityId: string;
    readonly verifierSubjectId: string;
    readonly evidenceRef: string;
    readonly correlationId: string;
  },
): Promise<{ readonly legalEntityId: string; readonly idempotent: boolean }> {
  const evidenceRef = input.evidenceRef.trim();
  if (!evidenceRef) throw new Error('ENTERPRISE_LEGAL_ENTITY_VERIFICATION_EVIDENCE_REQUIRED');

  const entity = await client.query<{
    status: string;
    created_by_subject_id: string;
    verification_source: string | null;
  }>(
    `SELECT status, created_by_subject_id, verification_source
       FROM platform.legal_entities
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND legal_entity_id = $3::uuid
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.enterpriseId, input.legalEntityId],
  );
  const row = entity.rows[0];
  if (!row) throw new Error('ENTERPRISE_LEGAL_ENTITY_NOT_FOUND');
  if (row.status === 'VERIFIED') {
    if (row.verification_source !== evidenceRef) {
      throw new Error('ENTERPRISE_LEGAL_ENTITY_VERIFICATION_CONFLICT');
    }
    return { legalEntityId: input.legalEntityId, idempotent: true };
  }
  if (row.status !== 'VERIFICATION_PENDING') {
    throw new Error('ENTERPRISE_LEGAL_ENTITY_NOT_VERIFIABLE');
  }
  if (row.created_by_subject_id === input.verifierSubjectId) {
    throw new Error('ENTERPRISE_LEGAL_ENTITY_SEPARATION_OF_DUTIES_REQUIRED');
  }

  const pending = await client.query<{ count: string | number }>(
    `SELECT count(*) AS count
       FROM platform.legal_entity_registration_identifiers
      WHERE tenant_id = $1::uuid
        AND legal_entity_id = $2::uuid
        AND verification_status = 'PENDING'
        AND valid_until IS NULL`,
    [input.tenantId, input.legalEntityId],
  );
  if (Number(pending.rows[0]?.count ?? 0) === 0) {
    throw new Error('ENTERPRISE_LEGAL_ENTITY_REGISTRATION_REQUIRED');
  }

  await client.query(
    `UPDATE platform.legal_entity_registration_identifiers
        SET verification_status = 'VERIFIED'
      WHERE tenant_id = $1::uuid
        AND legal_entity_id = $2::uuid
        AND verification_status = 'PENDING'
        AND valid_until IS NULL`,
    [input.tenantId, input.legalEntityId],
  );
  await client.query(
    `UPDATE platform.legal_entities
        SET status = 'VERIFIED',
            verification_source = $4,
            verified_at = now(),
            updated_by_subject_id = $5,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND legal_entity_id = $3::uuid`,
    [
      input.tenantId,
      input.enterpriseId,
      input.legalEntityId,
      evidenceRef,
      input.verifierSubjectId,
    ],
  );

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'enterprise.legal_entity',
      aggregateId: input.legalEntityId,
      eventType: 'enterprise.legal_entity.verified',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.verifierSubjectId,
      correlationId: input.correlationId,
      payload: {
        enterpriseId: input.enterpriseId,
        evidenceRef,
      },
    },
  });

  return { legalEntityId: input.legalEntityId, idempotent: false };
}
