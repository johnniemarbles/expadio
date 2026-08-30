import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DENTEX_PACK,
  evaluateCaseStageSemantics,
  resolveCaseStageSemantics,
} from '../src/index.ts';

test('DENTEX intake exit blocks until patient and practice relationships exist', () => {
  const semantics = resolveCaseStageSemantics(DENTEX_PACK);
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

test('DENTEX treatment exit requires a meaningful procedure code', () => {
  const semantics = resolveCaseStageSemantics(DENTEX_PACK);
  const blocked = evaluateCaseStageSemantics(semantics, {
    stageKey: 'IN_PROGRESS',
    phase: 'EXIT',
    attributes: { procedureCode: '   ' },
    relationships: [],
    decisionOutcomes: [],
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockers[0]?.code, 'CASE_SEMANTIC_ATTRIBUTE_REQUIRED');
  assert.equal(blocked.blockers[0]?.key, 'procedureCode');

  const allowed = evaluateCaseStageSemantics(semantics, {
    stageKey: 'IN_PROGRESS',
    phase: 'EXIT',
    attributes: { procedureCode: 'D2740' },
    relationships: [],
    decisionOutcomes: [],
  });
  assert.equal(allowed.ok, true);
});

test('DENTEX review exit requires care plan plus canonical APPROVE outcome', () => {
  const semantics = resolveCaseStageSemantics(DENTEX_PACK);
  const blocked = evaluateCaseStageSemantics(semantics, {
    stageKey: 'REVIEW',
    phase: 'EXIT',
    attributes: {},
    relationships: ['crm.agreement'],
    decisionOutcomes: ['RETURN'],
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockers[0]?.code, 'CASE_SEMANTIC_DECISION_OUTCOME_REQUIRED');
  assert.equal(blocked.blockers[0]?.key, 'APPROVE');

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
  const semantics = resolveCaseStageSemantics(DENTEX_PACK);
  const result = evaluateCaseStageSemantics(semantics, {
    stageKey: 'RESOLVED',
    phase: 'EXIT',
    attributes: {},
    relationships: [],
    decisionOutcomes: [],
  });
  assert.deepEqual(result, { ok: true, blockers: [] });
});
