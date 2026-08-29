import assert from 'node:assert/strict';
import test from 'node:test';
import { validateIndustryProfile, validatePresentationTerminology } from '@expadio/business-config';
import {
  DENTEX_PACK,
  LEXFLOW_PACK,
  INDUSTRY_PACKS,
  NEUTRAL_CRM_VOCABULARY,
  NEUTRAL_CASE_WORKFLOW_VOCABULARY,
  findIndustryPack,
  resolveCrmVocabulary,
  resolveCaseWorkflowVocabulary,
  resolveWorkTypeLabel,
  resolveStageLabel,
  resolveCaseSchema,
  validateCaseAttributes,
  NEUTRAL_CASE_SCHEMA,
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

test('governance labels relabel only crm.case under an active pack', () => {
  // DENTEX relabels the case process and its stages.
  assert.equal(resolveWorkTypeLabel(DENTEX_PACK, 'crm.case'), 'Treatment');
  assert.equal(resolveStageLabel(DENTEX_PACK, 'crm.case', 'INTAKE'), 'Consultation');
  // Other verticals keep their raw work type / stage even under a pack.
  assert.equal(resolveWorkTypeLabel(DENTEX_PACK, 'vendor.onboarding'), 'vendor.onboarding');
  assert.equal(resolveStageLabel(DENTEX_PACK, 'vendor.onboarding', 'APPROVAL'), 'APPROVAL');
  // No pack → raw keys everywhere (the neutral engine is unchanged).
  assert.equal(resolveWorkTypeLabel(null, 'crm.case'), 'crm.case');
  assert.equal(resolveStageLabel(null, 'crm.case', 'INTAKE'), 'INTAKE');
  // A null/unknown stage falls back safely.
  assert.equal(resolveStageLabel(DENTEX_PACK, 'crm.case', null), '');
  assert.equal(resolveStageLabel(DENTEX_PACK, 'crm.case', 'MYSTERY'), 'MYSTERY');
});

test('DENTEX adds domain fields to the case; the neutral engine adds none', () => {
  const schema = resolveCaseSchema(DENTEX_PACK);
  assert.deepEqual(schema.fields.map((f) => f.key), ['tooth', 'procedureCode', 'urgency']);
  const urgency = schema.fields.find((f) => f.key === 'urgency');
  assert.ok(urgency && urgency.type === 'select' && urgency.required === true);
  assert.deepEqual(resolveCaseSchema(null), NEUTRAL_CASE_SCHEMA);
});

test('a case schema carries a version, stamped through validation', () => {
  // A pack schema is versioned (starts at 1); the neutral engine has no schema (0).
  assert.equal(resolveCaseSchema(DENTEX_PACK).version, 1);
  assert.equal(resolveCaseSchema(LEXFLOW_PACK).version, 1);
  assert.equal(NEUTRAL_CASE_SCHEMA.version, 0);
  // The validator reports the version that validated the attributes, so the
  // caller can stamp it onto the stored case.
  assert.equal(validateCaseAttributes(resolveCaseSchema(DENTEX_PACK), { urgency: 'Routine' }).schemaVersion, 1);
  assert.equal(validateCaseAttributes(NEUTRAL_CASE_SCHEMA, { anything: 1 }).schemaVersion, 0);
});

test('case attributes are validated and normalized against the pack schema', () => {
  const schema = resolveCaseSchema(DENTEX_PACK);
  // Unknown keys dropped; known ones trimmed; required select present and valid.
  const ok = validateCaseAttributes(schema, { tooth: '  UR6 ', urgency: 'Emergency', junk: 'x' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.attributes, { tooth: 'UR6', urgency: 'Emergency' });
  // A bad select value is rejected, and nothing is invented.
  const badSelect = validateCaseAttributes(schema, { urgency: 'Whenever' });
  assert.equal(badSelect.ok, false);
  assert.match(badSelect.errors.join(' '), /Urgency must be one of/);
  assert.deepEqual(badSelect.attributes, {});
  // A missing required field is reported.
  const missing = validateCaseAttributes(schema, { tooth: 'UL4' });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /Urgency is required/);
  // The neutral schema validates anything (no fields).
  assert.equal(validateCaseAttributes(NEUTRAL_CASE_SCHEMA, { anything: 1 }).ok, true);
});

test('LEXFLOW proves the reskin generalizes — a second vertical, all as data', () => {
  // Different entity words than DENTEX, over the same canonical concept keys.
  const vocab = resolveCrmVocabulary(LEXFLOW_PACK);
  assert.equal(vocab.account.plural, 'Clients');
  assert.equal(vocab.case.plural, 'Matters');
  assert.equal(vocab.agreement.plural, 'Engagement letters');
  // A different process language on the same four canonical stages.
  const wf = resolveCaseWorkflowVocabulary(LEXFLOW_PACK);
  assert.equal(wf.workType, 'Matter');
  assert.equal(wf.stages.INTAKE, 'Intake & conflicts');
  assert.equal(wf.stages.RESOLVED, 'Closed');
  assert.equal(resolveWorkTypeLabel(LEXFLOW_PACK, 'crm.case'), 'Matter');
  assert.equal(resolveStageLabel(LEXFLOW_PACK, 'crm.case', 'REVIEW'), 'Partner review');
  // Its own case fields — a required select plus free-text, distinct from DENTEX.
  const schema = resolveCaseSchema(LEXFLOW_PACK);
  assert.deepEqual(schema.fields.map((f) => f.key), ['matterType', 'jurisdiction', 'opposingParty']);
  const matterType = schema.fields.find((f) => f.key === 'matterType');
  assert.ok(matterType && matterType.type === 'select' && matterType.required === true);
  // The same validator enforces the new schema — bad select rejected, good accepted.
  assert.equal(validateCaseAttributes(schema, { matterType: 'Tax' }).ok, false);
  const good = validateCaseAttributes(schema, { matterType: 'Litigation', jurisdiction: ' NY ', junk: 'x' });
  assert.equal(good.ok, true);
  assert.deepEqual(good.attributes, { matterType: 'Litigation', jurisdiction: 'NY' });
  // Both packs are discoverable by the picker and by case-insensitive lookup.
  assert.equal(findIndustryPack('LexFlow')?.verticalKey, 'lexflow');
  const choices = listIndustryPackChoices();
  assert.ok(choices.some((c) => c.verticalKey === 'lexflow'));
  assert.ok(choices.some((c) => c.verticalKey === 'dentex'));
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
