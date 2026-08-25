import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresWorkflowStageDecisionRepository } from '../src/workflow-decision.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import type { WorkflowStageDecisionRecord } from '@expadio/workflow';

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

const record: WorkflowStageDecisionRecord = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  instanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workTypeKey: 'partner-onboarding',
  stageKey: 'decision',
  decisionId: 'decision-1',
  outcome: 'APPROVED',
  decidedBySubjectId: 'subject-1',
  decidedAt: '2026-08-25T08:30:00.000Z',
  code: 'APPROVED_BY_AUTHORITY',
  evidenceRefs: ['approval:1'],
};

const row = {
  decision_id: record.decisionId,
  tenant_id: record.tenantId,
  instance_id: record.instanceId,
  work_type_key: record.workTypeKey,
  stage_key: record.stageKey,
  outcome: record.outcome,
  decided_by_subject_id: record.decidedBySubjectId,
  decided_at: record.decidedAt,
  code: record.code,
  evidence_refs: record.evidenceRefs,
};

test('record returns COMMITTED when insert succeeds', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowStageDecisionRepository(client).record(record);

  assert.equal(result.status, 'COMMITTED');
  assert.match(client.calls[0]?.text ?? '', /ON CONFLICT DO NOTHING/);
  assert.equal(client.calls.length, 1);
});

test('record classifies exact replay after uniqueness conflict', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({ rows: [row], rowCount: 1 });

  const result = await new PostgresWorkflowStageDecisionRepository(client).record(record);

  assert.equal(result.status, 'ALREADY_RECORDED');
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[1]?.text ?? '', /FROM platform\.workflow_stage_decisions/);
});

test('record returns CONFLICT when a different immutable decision already exists', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });
  client.responses.push({
    rows: [{ ...row, decision_id: 'decision-existing', outcome: 'REJECTED' }],
    rowCount: 1,
  });

  const result = await new PostgresWorkflowStageDecisionRepository(client).record(record);

  assert.equal(result.status, 'CONFLICT');
  if (result.status === 'CONFLICT') {
    assert.equal(result.existing.outcome, 'REJECTED');
  }
});

test('resolve binds tenant, instance, stage and work type explicitly', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [row], rowCount: 1 });

  const decision = await new PostgresWorkflowStageDecisionRepository(client).resolve(record);

  assert.equal(decision?.decisionId, 'decision-1');
  assert.deepEqual(client.calls[0]?.values, [
    record.tenantId,
    record.instanceId,
    record.stageKey,
    record.workTypeKey,
  ]);
});
