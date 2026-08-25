import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowActivationVerificationRecord,
} from '@expadio/workflow';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import { PostgresWorkflowActivationVerificationRepository } from '../src/workflow-activation-verification.ts';

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: SqlQueryResult[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as SqlQueryResult<Row>;
  }
}

const verification: WorkflowActivationVerificationRecord = {
  verificationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  instanceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  activationId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  state: 'VERIFIED',
  assessments: [
    { dimension: 'AGREEMENT', outcome: 'SATISFIED', reason: 'Current.', evidenceRefs: ['agreement:1'] },
    { dimension: 'RIGHTS', outcome: 'SATISFIED', reason: 'Active.', evidenceRefs: ['rights:1'] },
    { dimension: 'ACCESS', outcome: 'SATISFIED', reason: 'Tested.', evidenceRefs: ['access:1'] },
    { dimension: 'COMPLIANCE', outcome: 'SATISFIED', reason: 'Passed.', evidenceRefs: ['compliance:1'] },
    { dimension: 'OPERATIONAL_READINESS', outcome: 'SATISFIED', reason: 'Ready.', evidenceRefs: ['readiness:1'] },
  ],
  verifiedBySubjectId: 'verifier-1',
  verifiedAt: '2026-08-25T13:30:00.000Z',
  reason: 'All controls passed.',
  evidenceRefs: ['verification-pack:1'],
};

const row = {
  verification_id: verification.verificationId,
  tenant_id: verification.tenantId,
  instance_id: verification.instanceId,
  activation_id: verification.activationId,
  state: verification.state,
  assessments: verification.assessments,
  verified_by_subject_id: verification.verifiedBySubjectId,
  verified_at: verification.verifiedAt,
  reason: verification.reason,
  evidence_refs: verification.evidenceRefs,
};

test('find resolves one tenant-scoped verification fact', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowActivationVerificationRepository(client)
    .find({
      tenantId: verification.tenantId,
      verificationId: verification.verificationId,
    });

  assert.deepEqual(result, verification);
  assert.deepEqual(client.calls[0]?.values, [
    verification.tenantId,
    verification.verificationId,
  ]);
  assert.match(client.calls[0]?.text ?? '', /tenant_id = \$1::uuid/);
  assert.match(client.calls[0]?.text ?? '', /verification_id = \$2::uuid/);
});

test('record returns COMMITTED for a new verification fact', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowActivationVerificationRepository(client)
    .record(verification);

  assert.equal(result.status, 'COMMITTED');
  assert.deepEqual(result.verification, verification);
  assert.equal(client.calls[0]?.values[5], JSON.stringify(verification.assessments));
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT DO NOTHING/);
});

test('record maps an exact retry to ALREADY_RECORDED', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowActivationVerificationRepository(client)
    .record(verification);

  assert.equal(result.status, 'ALREADY_RECORDED');
  assert.equal(client.calls.length, 2);
});

test('record returns CONFLICT when immutable content differs', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({ rows: [{ ...row, state: 'FAILED' }], rowCount: 1 });

  const result = await new PostgresWorkflowActivationVerificationRepository(client)
    .record(verification);

  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.existing.state, 'FAILED');
});
