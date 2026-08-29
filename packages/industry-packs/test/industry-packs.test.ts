import assert from 'node:assert/strict';
import test from 'node:test';
import { validateIndustryProfile, validatePresentationTerminology } from '@expadio/business-config';
import {
  DENTEX_PACK,
  INDUSTRY_PACKS,
  NEUTRAL_CRM_VOCABULARY,
  NEUTRAL_CASE_WORKFLOW_VOCABULARY,
  findIndustryPack,
  resolveCrmVocabulary,
  resolveCaseWorkflowVocabulary,
  listIndustryPackChoices,
} from '../src/index.ts';

test('every pack is a valid governed configuration artifact', () => {
  for (const pack of INDUSTRY_PACKS) {
    const profile = validateIndustryProfile(pack.profile);
    assert.ok(profile.valid, `${pack.verticalKey} profile: ${JSON.stringify(profile)}`);
    const terminology = validatePresentationTerminology(pack.terminology);
    assert.ok(terminology.valid, `${pack.verticalKey} terminology: ${JSON.stringify(terminology)}`);
  }
});

test('DENTEX reskins the neutral CRM concepts', () => {
  const vocab = resolveCrmVocabulary(DENTEX_PACK);
  assert.equal(vocab.account.plural, 'Practices');
  assert.equal(vocab.contact.plural, 'Patients');
  assert.equal(vocab.lead.plural, 'Referrals');
  assert.equal(vocab.case.plural, 'Treatments');
  assert.equal(vocab.agreement.plural, 'Care plans');
});

test('DENTEX reskins the case workflow lifecycle as a course of care', () => {
  const wf = resolveCaseWorkflowVocabulary(DENTEX_PACK);
  assert.equal(wf.workType, 'Treatment');
  assert.equal(wf.stages.INTAKE, 'Consultation');
  assert.equal(wf.stages.IN_PROGRESS, 'In treatment');
  assert.equal(wf.stages.REVIEW, 'Clinical review');
  assert.equal(wf.stages.RESOLVED, 'Discharged');
});

test('no pack falls back to the neutral case workflow vocabulary', () => {
  assert.deepEqual(resolveCaseWorkflowVocabulary(null), NEUTRAL_CASE_WORKFLOW_VOCABULARY);
  assert.deepEqual(resolveCaseWorkflowVocabulary(findIndustryPack('nope')), NEUTRAL_CASE_WORKFLOW_VOCABULARY);
});

test('no pack (or unknown key) falls back to the neutral engine vocabulary', () => {
  assert.deepEqual(resolveCrmVocabulary(null), NEUTRAL_CRM_VOCABULARY);
  assert.equal(findIndustryPack('does-not-exist'), null);
  assert.equal(findIndustryPack(''), null);
  assert.deepEqual(resolveCrmVocabulary(findIndustryPack(undefined)), NEUTRAL_CRM_VOCABULARY);
});

test('pack lookup is case-insensitive and exposed for a picker', () => {
  assert.equal(findIndustryPack('DENTEX')?.verticalKey, 'dentex');
  const choices = listIndustryPackChoices();
  assert.ok(choices.some((c) => c.verticalKey === 'dentex'));
});

test('resolution never changes canonical keys — only display text', () => {
  // The concept keys are the stable identity; the pack only supplies labels.
  const keys = DENTEX_PACK.terminology.concepts.map((c) => c.conceptKey);
  assert.deepEqual(keys, ['crm.account', 'crm.contact', 'crm.lead', 'crm.case', 'crm.agreement']);
});
