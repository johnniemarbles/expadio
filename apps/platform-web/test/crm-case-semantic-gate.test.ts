import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { evaluateCrmCaseSemanticTransition } from '../lib/crm-case-semantic-gate.ts';

function scriptedClient(input: {
  readonly caseRow: {
    readonly attributes: Readonly<Record<string, unknown>>;
    readonly account_id: string | null;
    readonly contact_id: string | null;
    readonly industry_pack_vertical_key: string | null;
    readonly has_active_agreement: boolean;
  };
  readonly decisions?: Readonly<Record<string, string>>;
}) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const client = {
    async query(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      if (text.includes('FROM platform.crm_cases c')) {
        return { rows: [input.caseRow], rowCount: 1 };
      }
      if (text.includes('FROM platform.industry_pack_versions')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM platform.workflow_stage_decisions')) {
        const stageKey = String(values[2] ?? '');
        const outcome = input.decisions?.[stageKey];
        if (outcome === undefined) return { rows: [], rowCount: 0 };
        return {
          rows: [{
            decision_id: 'decision-1',
            tenant_id: values[0],
            instance_id: values[1],
            work_type_key: values[3],
            stage_key: stageKey,
            outcome,
            decided_by_subject_id: 'reviewer-1',
            decided_at: '2026-08-30T02:00:00.000Z',
            code: 'crm.case.decision',
            evidence_refs: [],
          }],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as PoolClient;

  return { client, calls };
}

const base = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  instanceId: '22222222-2222-2222-2222-222222222222',
  caseId: '33333333-3333-3333-3333-333333333333',
  workTypeKey: 'crm.case',
} as const;

test('pack intake exit blocks from canonical case relationships', async () => {
  const { client } = scriptedClient({
    caseRow: {
      attributes: {},
      account_id: null,
      contact_id: '44444444-4444-4444-4444-444444444444',
      industry_pack_vertical_key: 'acme-corp',
      has_active_agreement: false,
    },
  });

  const blockers = await evaluateCrmCaseSemanticTransition(client, {
    ...base,
    fromStageKey: 'INTAKE',
    toStageKey: 'IN_PROGRESS',
  });

  assert.deepEqual(blockers.map((item) => [item.kind, item.code, item.key]), [
    ['EXIT_CONDITION', 'CASE_SEMANTIC_RELATIONSHIP_REQUIRED', 'crm.account'],
  ]);
  assert.equal(blockers[0]?.message, 'A contact and client must be linked before work begins.');
});

test('pack review exit uses immutable decision and linked agreement facts', async () => {
  const { client, calls } = scriptedClient({
    caseRow: {
      attributes: { serviceType: 'Consulting' },
      account_id: '55555555-5555-5555-5555-555555555555',
      contact_id: '44444444-4444-4444-4444-444444444444',
      industry_pack_vertical_key: 'acme-corp',
      has_active_agreement: true,
    },
    decisions: { REVIEW: 'APPROVE' },
  });

  const blockers = await evaluateCrmCaseSemanticTransition(client, {
    ...base,
    fromStageKey: 'REVIEW',
    toStageKey: 'RESOLVED',
  });

  assert.deepEqual(blockers, []);
  const caseQuery = calls.find((call) => call.text.includes('FROM platform.crm_cases c'))?.text ?? '';
  assert.match(caseQuery, /platform\.entity_relationships/);
  assert.match(caseQuery, /target_entity_type = 'crm\.agreement'/);
});

test('non-CRM work types never resolve CRM or Industry Pack facts', async () => {
  let queried = false;
  const client = {
    async query() {
      queried = true;
      throw new Error('should not query');
    },
  } as unknown as PoolClient;

  const blockers = await evaluateCrmCaseSemanticTransition(client, {
    ...base,
    workTypeKey: 'expense.reimbursement',
    fromStageKey: 'REVIEW',
    toStageKey: 'RESOLVED',
  });

  assert.deepEqual(blockers, []);
  assert.equal(queried, false);
});
