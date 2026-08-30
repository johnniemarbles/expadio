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
  resolveDecisionOutcomeLabel,
  resolveWorkTypeLabel,
  resolveStageLabel,
  resolveCaseSchema,
  resolveCaseOntology,
  resolveRelationshipDefinitions,
  resolveCaseLifecycleEvent,
  resolveGovernedActionRules,
  describeIndustryPack,
  listIndustryPackCatalog,
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

test('a pack reskins the decision experience without changing the recorded outcome', () => {
  // The clinician's words for the canonical APPROVE/RETURN.
  assert.equal(resolveDecisionOutcomeLabel(DENTEX_PACK, 'APPROVE'), 'Approve treatment plan');
  assert.equal(resolveDecisionOutcomeLabel(DENTEX_PACK, 'RETURN'), 'Send back for revision');
  assert.equal(resolveDecisionOutcomeLabel(LEXFLOW_PACK, 'APPROVE'), 'Approve & proceed');
  // An outcome a pack doesn't relabel, and the neutral engine, keep the canonical key.
  assert.equal(resolveDecisionOutcomeLabel(DENTEX_PACK, 'ESCALATE'), 'ESCALATE');
  assert.equal(resolveDecisionOutcomeLabel(null, 'APPROVE'), 'APPROVE');
  // Per-stage domain guidance is carried on the resolved vocabulary.
  const wf = resolveCaseWorkflowVocabulary(DENTEX_PACK);
  assert.match(wf.stageGuidance?.REVIEW ?? '', /clinician/i);
  assert.deepEqual(resolveCaseWorkflowVocabulary(null).stageGuidance, {});
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

test('a pack exposes its case as an explicit domain model over the canonical relations', () => {
  const onto = resolveCaseOntology(DENTEX_PACK);
  // The case entity is the pack's work type.
  assert.equal(onto.entity, 'Treatment');
  // The canonical account/contact/agreement relations, labelled + roled in the
  // pack's words — no new relations invented.
  assert.deepEqual(onto.relationships.map((r) => r.conceptKey), ['crm.account', 'crm.contact', 'crm.agreement']);
  const patient = onto.relationships.find((r) => r.conceptKey === 'crm.contact');
  assert.equal(patient?.entityLabel, 'Patient');
  assert.equal(patient?.role, 'Patient treated');
  // The domain fields come from the pack's schema.
  assert.deepEqual(onto.fields.map((f) => f.key), ['tooth', 'procedureCode', 'urgency']);
  // The neutral engine yields a generic model over the same canonical relations.
  const neutral = resolveCaseOntology(null);
  assert.equal(neutral.entity, 'Case');
  assert.equal(neutral.relationships.find((r) => r.conceptKey === 'crm.contact')?.entityLabel, 'Contact');
  assert.equal(neutral.relationships.find((r) => r.conceptKey === 'crm.contact')?.role, 'Concerns');
  assert.deepEqual(neutral.fields, []);
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

test('the management plane describes what each pack configures', () => {
  const dentex = describeIndustryPack(DENTEX_PACK);
  assert.equal(dentex.verticalKey, 'dentex');
  assert.equal(dentex.entities.case, 'Treatment');
  assert.equal(dentex.workType, 'Treatment');
  assert.deepEqual(dentex.stages.map((s) => s.key), ['INTAKE', 'IN_PROGRESS', 'REVIEW', 'RESOLVED']);
  assert.equal(dentex.stages.find((s) => s.key === 'INTAKE')?.label, 'Consultation');
  assert.equal(dentex.caseSchemaVersion, 1);
  assert.deepEqual(dentex.caseFields.map((f) => f.key), ['tooth', 'procedureCode', 'urgency']);
  assert.equal(dentex.caseFields.find((f) => f.key === 'urgency')?.required, true);
  assert.equal(dentex.relationships.find((r) => r.conceptKey === 'crm.contact')?.entityLabel, 'Patient');
  // The catalog covers every registered pack.
  const catalog = listIndustryPackCatalog();
  assert.deepEqual([...catalog.map((c) => c.verticalKey)].sort(), ['dentex', 'lexflow']);
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


test('DENTEX declares provider through the horizontal Relationship Fabric', () => {
  const definitions = resolveRelationshipDefinitions(DENTEX_PACK, 'crm.case');
  const provider = definitions.find((definition) => definition.key === 'provider');
  assert.deepEqual(provider, {
    key: 'provider',
    label: 'Treating provider',
    sourceEntityType: 'crm.case',
    targetEntityTypes: ['iam.subject'],
    cardinality: 'ZERO_OR_ONE',
  });
  assert.deepEqual(definitions.find((definition) => definition.key === 'care_plan'), {
    key: 'care_plan',
    label: 'Care plan',
    sourceEntityType: 'crm.case',
    targetEntityTypes: ['crm.agreement'],
    cardinality: 'ZERO_OR_ONE',
  });

  // The neutral engine and a pack that does not declare this relationship do
  // not manufacture a provider role.
  assert.deepEqual(resolveRelationshipDefinitions(null), []);
  assert.equal(
    resolveRelationshipDefinitions(LEXFLOW_PACK, 'crm.case').some((d) => d.key === 'provider'),
    false,
  );
});

test('management-plane pack description exposes Relationship Fabric declarations', () => {
  const dentex = describeIndustryPack(DENTEX_PACK);
  assert.equal(dentex.relationshipDefinitions.find((d) => d.key === 'provider')?.label, 'Treating provider');
});


test('DENTEX lifecycle Domain Events are Pack semantics, not workflow hardcoding', () => {
  assert.deepEqual(resolveCaseLifecycleEvent(DENTEX_PACK, 'INTAKE'), {
    stageKey: 'INTAKE',
    eventType: 'Treatment.ConsultationEntered',
    eventVersion: 1,
  });
  assert.deepEqual(resolveCaseLifecycleEvent(DENTEX_PACK, 'RESOLVED'), {
    stageKey: 'RESOLVED',
    eventType: 'Treatment.Discharged',
    eventVersion: 1,
  });
  assert.equal(resolveCaseLifecycleEvent(LEXFLOW_PACK, 'RESOLVED'), null);
  assert.equal(resolveCaseLifecycleEvent(null, 'RESOLVED'), null);
});


test('DENTEX discharge follow-up is a governed Pack rule with runtime bindings', () => {
  const rules = resolveGovernedActionRules(DENTEX_PACK, 'Treatment.Discharged');
  assert.equal(rules.length, 1);
  const rule = rules[0]!;
  assert.equal(rule.ruleKey, 'dentex.treatment.discharge.patient-follow-up');
  assert.equal(rule.executorClass, 'COMMUNICATE');
  assert.equal(rule.actionKey, 'patient.follow_up');

  const configuration = rule.configuration as any;
  assert.deepEqual(configuration.recipient.email, {
    kind: 'AGGREGATE_FIELD',
    key: 'contactEmail',
  });
  assert.deepEqual(configuration.variables.patientName, {
    kind: 'AGGREGATE_FIELD',
    key: 'contactName',
  });
  assert.equal(
    JSON.stringify(configuration).includes('patient@example'),
    false,
  );

  assert.deepEqual(
    resolveGovernedActionRules(LEXFLOW_PACK, 'Treatment.Discharged'),
    [],
  );
});
