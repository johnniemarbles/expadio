import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACME_CORP_PACK,
  evaluateCaseStageSemantics,
  resolveCaseStageSemantics,
} from '../src/index.ts';

test('ACME Corp intake exit blocks until contact and client relationships exist', () => {
  const semantics = resolveCaseStageSemantics(ACME_CORP_PACK);
  const blocked = evaluateCaseStageSemantics(semantics, {
    stageKey: 'INTAKE',
    phase: 'EXIT',
    attributes: {},
    relationships: ['crm.contact'],
    decisionOutcomes: [],
  });

  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blockers.map((item) => [item.code, item.key]), [
    ['CASE_SEMANTIC_RELATIONSHIP_REQUIRED', 'crm.account'],
  ]);

  const allowed = evaluateCaseStageSemantics(semantics, {
    stageKey: 'INTAKE',
    phase: 'EXIT',
    attributes: {},
    relationships: ['crm.contact', 'crm.account'],
    decisionOutcomes: [],
  });
  assert.deepEqual(allowed, { ok: true, blockers: [] });
});

test('ACME Corp request exit requires a service type', () => {
  const semantics = resolveCaseStageSemantics(ACME_CORP_PACK);
  const blocked = evaluateCaseStageSemantics(semantics, {
    stageKey: 'IN_PROGRESS',
    phase: 'EXIT',
    attributes: { serviceType: '   ' },
    relationships: [],
    decisionOutcomes: [],
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockers[0]?.code, 'CASE_SEMANTIC_ATTRIBUTE_REQUIRED');
  assert.equal(blocked.blockers[0]?.key, 'serviceType');

  const allowed = evaluateCaseStageSemantics(semantics, {
    stageKey: 'IN_PROGRESS',
    phase: 'EXIT',
    attributes: { serviceType: 'Consulting' },
    relationships: [],
    decisionOutcomes: [],
  });
  assert.equal(allowed.ok, true);
});

test('ACME Corp review exit requires service agreement plus canonical APPROVE outcome', () => {
  const semantics = resolveCaseStageSemantics(ACME_CORP_PACK);
  const blocked = evaluateCaseStageSemantics(semantics, {
    stageKey: 'REVIEW',
    phase: 'EXIT',
    attributes: {},
    relationships: [],
    decisionOutcomes: [],
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockers.length, 2);

  const allowed = evaluateCaseStageSemantics(semantics, {
    stageKey: 'REVIEW',
    phase: 'EXIT',
    attributes: {},
    relationships: ['crm.agreement'],
    decisionOutcomes: ['APPROVE'],
  });
  assert.equal(allowed.ok, true);
});

test('requirements for another stage or phase do not block', () => {
  const semantics = resolveCaseStageSemantics(ACME_CORP_PACK);
  const result = evaluateCaseStageSemantics(semantics, {
    stageKey: 'RESOLVED',
    phase: 'EXIT',
    attributes: {},
    relationships: [],
    decisionOutcomes: [],
  });
  assert.deepEqual(result, { ok: true, blockers: [] });
});
