import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideEnterpriseOwnershipChange,
  requestEnterpriseOwnershipChange,
  type EnterpriseOwnershipSqlClient,
} from '../../../packages/postgres-runtime/src/enterprise-ownership.ts';

const TENANT = '70100000-0000-0000-0000-000000000001';
const ENTERPRISE = '70100000-0000-0000-0000-000000000002';
const ORG = '70100000-0000-0000-0000-000000000003';
const OWNER = '70100000-0000-0000-0000-000000000011';
const SUBJECT = '70100000-0000-0000-0000-000000000012';

interface InterestState {
  interest_id: string;
  enterprise_change_request_id: string;
  owner_entity_key: string;
  subject_entity_key: string;
  interest_type: 'EQUITY';
  percentage: number;
  valid_from: string;
  valid_until: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  created_by_subject_id: string;
  approved_by_subject_id: string | null;
  approved_at: string | null;
  evidence: Record<string, unknown>;
}

class OwnershipClient implements EnterpriseOwnershipSqlClient {
  requestId: string | null = null;
  requestPayload: Record<string, unknown> | null = null;
  requestStatus = 'SUBMITTED';
  interest: InterestState | null = null;
  readonly priorInterestId = '70100000-0000-0000-0000-000000000090';
  priorSupersededAt: string | null = null;
  graphSupersededValues: readonly unknown[] | null = null;
  publishedValues: readonly unknown[] | null = null;

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: readonly Row[]; rowCount: number | null }> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.includes('FROM platform.legal_entities')) {
      return { rows: [{ legal_entity_id: values[2] }] as Row[], rowCount: 1 };
    }
    if (sql.includes('resolve_or_register_entity_registry_node')) {
      return { rows: [{ node_id: 'node:' + String(values[1]) }] as Row[], rowCount: 1 };
    }
    if (
      sql.includes('FROM platform.enterprise_change_requests')
      && sql.includes('idempotency_key = $2')
    ) {
      return this.requestId
        ? {
            rows: [{
              enterprise_change_request_id: this.requestId,
              operation: 'CHANGE_OWNERSHIP',
              proposed_payload: this.requestPayload,
            }] as Row[],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO platform.enterprise_change_requests')) {
      this.requestId = String(values[0]);
      this.requestPayload = JSON.parse(String(values[5])) as Record<string, unknown>;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO platform.entity_ownership_interests')) {
      this.interest = {
        interest_id: String(values[0]),
        enterprise_change_request_id: String(values[10]),
        owner_entity_key: OWNER,
        subject_entity_key: SUBJECT,
        interest_type: 'EQUITY',
        percentage: Number(values[5]),
        valid_from: String(values[6]),
        valid_until: values[7] == null ? null : String(values[7]),
        status: 'PENDING',
        created_by_subject_id: String(values[9]),
        approved_by_subject_id: null,
        approved_at: null,
        evidence: JSON.parse(String(values[8])) as Record<string, unknown>,
      };
      return { rows: [], rowCount: 1 };
    }
    if (
      sql.includes('FROM platform.enterprise_change_requests')
      && sql.includes('enterprise_change_request_id = $2::uuid')
      && sql.includes('FOR UPDATE')
    ) {
      return {
        rows: [{
          enterprise_change_request_id: this.requestId,
          enterprise_id: ENTERPRISE,
          operation: 'CHANGE_OWNERSHIP',
          approving_organization_id: ORG,
          status: this.requestStatus,
          requested_by_subject_id: 'requester',
          correlation_id: 'correlation-1',
        }] as Row[],
        rowCount: 1,
      };
    }
    if (
      sql.includes('FROM platform.entity_ownership_interests interest')
      && sql.includes('enterprise_change_request_id = $2::uuid')
    ) {
      assert.ok(this.interest);
      return { rows: [this.interest] as Row[], rowCount: 1 };
    }
    if (
      sql.includes('FROM platform.entity_ownership_interests')
      && sql.includes("status = 'APPROVED'")
      && sql.includes('enterprise_change_request_id <> $2::uuid')
    ) {
      return {
        rows: [{
          interest_id: this.priorInterestId,
          valid_from: '2025-01-01T00:00:00.000Z',
        }] as Row[],
        rowCount: 1,
      };
    }
    if (
      sql.startsWith('UPDATE platform.entity_ownership_interests')
      && sql.includes("status = 'SUPERSEDED'")
    ) {
      this.priorSupersededAt = String(values[2]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE platform.entity_relationships')) {
      this.graphSupersededValues = values;
      return { rows: [], rowCount: 1 };
    }
    if (
      sql.startsWith('UPDATE platform.entity_ownership_interests')
      && sql.includes("status = 'APPROVED'")
    ) {
      assert.ok(this.interest);
      this.interest.status = 'APPROVED';
      this.interest.approved_by_subject_id = String(values[2]);
      this.interest.approved_at = new Date().toISOString();
      return { rows: [], rowCount: 1 };
    }
    if (
      sql.startsWith('UPDATE platform.enterprise_change_requests')
      && sql.includes("status = 'APPROVED'")
    ) {
      this.requestStatus = 'APPROVED';
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('platform.create_governed_entity_relationship')) {
      this.publishedValues = values;
      return {
        rows: [{ relationship_id: '70100000-0000-0000-0000-000000000099' }] as Row[],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 1 };
  }
}

test('ownership lifecycle proves replay, SoD, supersession and typed publication', async () => {
  const client = new OwnershipClient();
  const input = {
    tenantId: TENANT,
    enterpriseId: ENTERPRISE,
    governingOrganizationId: ORG,
    ownerLegalEntityId: OWNER,
    subjectLegalEntityId: SUBJECT,
    interestType: 'EQUITY',
    percentage: 60,
    validFrom: '2026-01-01T00:00:00.000Z',
    evidenceRefs: ['document:cap-table:v1'],
    requestedBySubjectId: 'requester',
    correlationId: 'correlation-1',
    idempotencyKey: 'ownership-request-1',
  } as const;

  const created = await requestEnterpriseOwnershipChange(client, input);
  assert.equal(created.idempotent, false);
  assert.equal(created.interest.status, 'PENDING');

  const replay = await requestEnterpriseOwnershipChange(client, input);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.requestId, created.requestId);

  await assert.rejects(
    requestEnterpriseOwnershipChange(client, {
      ...input,
      evidenceRefs: ['document:cap-table:v2'],
    }),
    /ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT/,
  );

  await assert.rejects(
    decideEnterpriseOwnershipChange(client, {
      tenantId: TENANT,
      requestId: created.requestId,
      approverOrganizationId: ORG,
      decidedBySubjectId: 'requester',
      action: 'APPROVE',
    }),
    /ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED/,
  );

  const approved = await decideEnterpriseOwnershipChange(client, {
    tenantId: TENANT,
    requestId: created.requestId,
    approverOrganizationId: ORG,
    decidedBySubjectId: 'independent-approver',
    action: 'APPROVE',
    decisionReason: 'Verified cap table.',
  });

  assert.equal(approved.status, 'APPROVED');
  assert.equal(client.priorSupersededAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(client.graphSupersededValues, [
    TENANT,
    OWNER,
    'OWNERSHIP_EQUITY',
    SUBJECT,
    '2026-01-01T00:00:00.000Z',
    'independent-approver',
  ]);
  assert.ok(client.publishedValues);
  assert.equal(client.publishedValues[3], 'OWNERSHIP_EQUITY');
  assert.equal(client.publishedValues[11], 'enterprise-change-request:' + created.requestId);
});
