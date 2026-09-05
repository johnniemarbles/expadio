import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  PostgresLeadTargetResolver,
  PostgresLeadDossierReader,
  PostgresOutreachBriefResolver,
  RevenueCommitteeReferenceError,
} from '../src/revenue-committee.ts';

class Client implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly steps: Array<SqlQueryResult> = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    return step as SqlQueryResult<Row>;
  }
}

const validReference = 'ref:task:22222222-2222-2222-2222-222222222222:input';

test('PostgresLeadTargetResolver resolves leadTarget from the task action_payload', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ action_payload: { leadTarget: 'acme.example.com' } }], rowCount: 1 });

  const resolver = new PostgresLeadTargetResolver(client);
  const target = await resolver.resolveTarget(validReference, 'tenant-1');

  assert.equal(target, 'acme.example.com');
  assert.equal(client.calls[0]?.values[0], '22222222-2222-2222-2222-222222222222');
  assert.equal(client.calls[0]?.values[1], 'tenant-1');
});

test('PostgresLeadTargetResolver rejects an invalid reference', async () => {
  const client = new Client();
  const resolver = new PostgresLeadTargetResolver(client);

  await assert.rejects(
    () => resolver.resolveTarget('not-a-reference', 'tenant-1'),
    (err: unknown) => err instanceof RevenueCommitteeReferenceError && err.code === 'REVENUE_REFERENCE_INVALID',
  );
});

test('PostgresLeadTargetResolver rejects a payload missing leadTarget', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ action_payload: {} }], rowCount: 1 });
  const resolver = new PostgresLeadTargetResolver(client);

  await assert.rejects(
    () => resolver.resolveTarget(validReference, 'tenant-1'),
    (err: unknown) => err instanceof RevenueCommitteeReferenceError && err.code === 'REVENUE_BRIEF_INCOMPLETE',
  );
});

test('PostgresLeadDossierReader reads a dossier back from agent_tenant_memory', async () => {
  const client = new Client();
  client.steps.push({
    rows: [
      {
        tenant_id: 'tenant-1',
        memory_key: 'lead-dossier:exec-1',
        memory_value: { companySize: '50-200' },
        metadata: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    rowCount: 1,
  });
  const reader = new PostgresLeadDossierReader(client);

  const dossier = await reader.getDossier('tenant-1', 'lead-dossier:exec-1');

  assert.deepEqual(dossier, { companySize: '50-200' });
});

test('PostgresLeadDossierReader returns null when no dossier is found', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 0 });
  const reader = new PostgresLeadDossierReader(client);

  assert.equal(await reader.getDossier('tenant-1', 'missing-key'), null);
});

test('PostgresOutreachBriefResolver resolves a full brief from the task action_payload', async () => {
  const client = new Client();
  client.steps.push({
    rows: [
      {
        action_payload: {
          leadName: 'Acme Salons',
          dossierKey: 'lead-dossier:exec-osint-1',
          brandVoiceGuideline: 'Direct',
          caseStudyReferences: ['case-study://1', 42, 'case-study://2'],
        },
      },
    ],
    rowCount: 1,
  });
  const resolver = new PostgresOutreachBriefResolver(client);

  const brief = await resolver.resolveBrief(validReference, 'tenant-1');

  assert.equal(brief.leadName, 'Acme Salons');
  assert.equal(brief.dossierKey, 'lead-dossier:exec-osint-1');
  // non-string entries in caseStudyReferences are filtered out rather than
  // silently coerced or allowed to crash the prompt builder downstream.
  assert.deepEqual(brief.caseStudyReferences, ['case-study://1', 'case-study://2']);
});

test('PostgresOutreachBriefResolver rejects a payload missing required fields', async () => {
  const client = new Client();
  client.steps.push({ rows: [{ action_payload: { leadName: 'Acme Salons' } }], rowCount: 1 });
  const resolver = new PostgresOutreachBriefResolver(client);

  await assert.rejects(
    () => resolver.resolveBrief(validReference, 'tenant-1'),
    (err: unknown) => err instanceof RevenueCommitteeReferenceError && err.code === 'REVENUE_BRIEF_INCOMPLETE',
  );
});
