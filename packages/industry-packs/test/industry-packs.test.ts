import assert from 'node:assert/strict';
import test from 'node:test';
import { validateIndustryProfile, validatePresentationTerminology } from '@expadio/business-config';
import {
  ACME_CORP_PACK,
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

test('ACME Corp reskins the neutral CRM concepts', () => {
  const vocab = resolveCrmVocabulary(ACME_CORP_PACK);
  assert.equal(vocab.account.plural, 'Clients');
  assert.equal(vocab.contact.plural, 'Contacts');
  assert.equal(vocab.lead.plural, 'Enquiries');
  assert.equal(vocab.case.plural, 'Service Requests');
  assert.equal(vocab.agreement.plural, 'Service Agreements');
});

test('ACME Corp reskins the case workflow lifecycle as service request lifecycle', () => {
  const wf = resolveCaseWorkflowVocabulary(ACME_CORP_PACK);
  assert.equal(wf.workType, 'Service Request');
  assert.equal(wf.stages.INTAKE, 'New Request');
  assert.equal(wf.stages.IN_PROGRESS, 'In Progress');
  assert.equal(wf.stages.REVIEW, 'Quality Review');
  assert.equal(wf.stages.RESOLVED, 'Completed');
});

test('a pack reskins the decision experience without changing the recorded outcome', () => {
  // The team's words for the canonical APPROVE/RETURN.
  assert.equal(resolveDecisionOutcomeLabel(ACME_CORP_PACK, 'APPROVE'), 'Approve & Close');
  assert.equal(resolveDecisionOutcomeLabel(ACME_CORP_PACK, 'RETURN'), 'Return for Revision');
  assert.equal(resolveDecisionOutcomeLabel(LEXFLOW_PACK, 'APPROVE'), 'Approve & proceed');
  // An outcome a pack doesn't relabel, and the neutral engine, keep the canonical key.
  assert.equal(resolveDecisionOutcomeLabel(ACME_CORP_PACK, 'ESCALATE'), 'ESCALATE');
  assert.equal(resolveDecisionOutcomeLabel(null, 'APPROVE'), 'APPROVE');
  // Per-stage domain guidance is carried on the resolved vocabulary.
  const wf = resolveCaseWorkflowVocabulary(ACME_CORP_PACK);
  assert.match(wf.stageGuidance?.REVIEW ?? '', /senior team member/i);
  assert.deepEqual(resolveCaseWorkflowVocabulary(null).stageGuidance, {});
});

test('governance labels relabel only crm.case under an active pack', () => {
  // ACME Corp relabels the case process and its stages.
  assert.equal(resolveWorkTypeLabel(ACME_CORP_PACK, 'crm.case'), 'Service Request');
  assert.equal(resolveStageLabel(ACME_CORP_PACK, 'crm.case', 'INTAKE'), 'New Request');
  // Other verticals keep their raw work type / stage even under a pack.
  assert.equal(resolveWorkTypeLabel(ACME_CORP_PACK, 'vendor.onboarding'), 'vendor.onboarding');
  assert.equal(resolveStageLabel(ACME_CORP_PACK, 'vendor.onboarding', 'APPROVAL'), 'APPROVAL');
  // No pack → raw keys everywhere (the neutral engine is unchanged).
  assert.equal(resolveWorkTypeLabel(null, 'crm.case'), 'crm.case');
  assert.equal(resolveStageLabel(null, 'crm.case', 'INTAKE'), 'INTAKE');
  // A null/unknown stage falls back safely.
  assert.equal(resolveStageLabel(ACME_CORP_PACK, 'crm.case', null), '');
  assert.equal(resolveStageLabel(ACME_CORP_PACK, 'crm.case', 'MYSTERY'), 'MYSTERY');
});

test('ACME Corp adds domain fields to the case; the neutral engine adds none', () => {
  const schema = resolveCaseSchema(ACME_CORP_PACK);
  assert.deepEqual(schema.fields.map((f) => f.key), ['serviceType', 'priority', 'referenceCode']);
  const priority = schema.fields.find((f) => f.key === 'priority');
  assert.ok(priority && priority.type === 'select' && priority.required === true);
  assert.deepEqual(resolveCaseSchema(null), NEUTRAL_CASE_SCHEMA);
});

test('a case schema carries a version, stamped through validation', () => {
  // A pack schema is versioned (starts at 1); the neutral engine has no schema (0).
  assert.equal(resolveCaseSchema(ACME_CORP_PACK).version, 1);
  assert.equal(resolveCaseSchema(LEXFLOW_PACK).version, 1);
  assert.equal(NEUTRAL_CASE_SCHEMA.version, 0);
  // The validator reports the version that validated the attributes, so the
  // caller can stamp it onto the stored case.
  assert.equal(validateCaseAttributes(resolveCaseSchema(ACME_CORP_PACK), { priority: 'Normal', serviceType: 'Consulting' }).schemaVersion, 1);
  assert.equal(validateCaseAttributes(NEUTRAL_CASE_SCHEMA, { anything: 1 }).schemaVersion, 0);
});

test('case attributes are validated and normalized against the pack schema', () => {
  const schema = resolveCaseSchema(ACME_CORP_PACK);
  // Unknown keys dropped; known ones trimmed; required select present and valid.
  const ok = validateCaseAttributes(schema, { serviceType: '  Consulting ', priority: 'High', junk: 'x' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.attributes, { serviceType: 'Consulting', priority: 'High' });
  // A bad select value is rejected, and nothing is invented.
  const badSelect = validateCaseAttributes(schema, { priority: 'Whenever' });
  assert.equal(badSelect.ok, false);
  assert.match(badSelect.errors.join(' '), /Priority must be one of/);
  assert.deepEqual(badSelect.attributes, {});
  // A missing required field is reported.
  const missing = validateCaseAttributes(schema, { referenceCode: 'REF-123' });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /Service type is required/);
  // The neutral schema validates anything (no fields).
  assert.equal(validateCaseAttributes(NEUTRAL_CASE_SCHEMA, { anything: 1 }).ok, true);
});

test('LEXFLOW proves the reskin generalizes — a second vertical, all as data', () => {
  // Different entity words than ACME Corp, over the same canonical concept keys.
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
  // Its own case fields — a required select plus free-text, distinct from ACME Corp.
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
  assert.ok(choices.some((c) => c.verticalKey === 'acme-corp'));
});

test('a pack exposes its case as an explicit domain model over the canonical relations', () => {
  const onto = resolveCaseOntology(ACME_CORP_PACK);
  // The case entity is the pack's work type.
  assert.equal(onto.entity, 'Service Request');
  // The canonical account/contact/agreement relations, labelled + roled in the
  // pack's words — no new relations invented.
  assert.deepEqual(onto.relationships.map((r) => r.conceptKey), ['crm.account', 'crm.contact', 'crm.agreement']);
  const contact = onto.relationships.find((r) => r.conceptKey === 'crm.contact');
  assert.equal(contact?.entityLabel, 'Contact');
  assert.equal(contact?.role, 'Requested by contact');
  // The domain fields come from the pack's schema.
  assert.deepEqual(onto.fields.map((f) => f.key), ['serviceType', 'priority', 'referenceCode']);
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
  const acme = describeIndustryPack(ACME_CORP_PACK);
  assert.equal(acme.verticalKey, 'acme-corp');
  assert.equal(acme.entities.case, 'Service Request');
  assert.equal(acme.workType, 'Service Request');
  assert.deepEqual(acme.stages.map((s) => s.key), ['INTAKE', 'IN_PROGRESS', 'REVIEW', 'RESOLVED']);
  assert.equal(acme.stages.find((s) => s.key === 'INTAKE')?.label, 'New Request');
  assert.equal(acme.caseSchemaVersion, 1);
  assert.deepEqual(acme.caseFields.map((f) => f.key), ['serviceType', 'priority', 'referenceCode']);
  assert.equal(acme.caseFields.find((f) => f.key === 'priority')?.required, true);
  assert.equal(acme.relationships.find((r) => r.conceptKey === 'crm.contact')?.entityLabel, 'Contact');
  // The catalog covers every registered pack.
  const catalog = listIndustryPackCatalog();
  assert.deepEqual([...catalog.map((c) => c.verticalKey)].sort(), ['acme-corp', 'lexflow']);
});

test('pack lookup is case-insensitive and exposed for a picker', () => {
  assert.equal(findIndustryPack('ACME-CORP')?.verticalKey, 'acme-corp');
  const choices = listIndustryPackChoices();
  assert.ok(choices.some((c) => c.verticalKey === 'acme-corp'));
});

test('resolution never changes canonical keys — only display text', () => {
  // The concept keys are the stable identity; the pack only supplies labels.
  const keys = ACME_CORP_PACK.terminology.concepts.map((c) => c.conceptKey);
  assert.deepEqual(keys, ['crm.account', 'crm.contact', 'crm.lead', 'crm.case', 'crm.agreement']);
});

test('ACME Corp declares agent assignment through the horizontal Relationship Fabric', () => {
  const definitions = resolveRelationshipDefinitions(ACME_CORP_PACK, 'crm.case');
  const agent = definitions.find((definition) => definition.key === 'assigned_agent');
  assert.deepEqual(agent, {
    key: 'assigned_agent',
    label: 'Assigned agent',
    sourceEntityType: 'crm.case',
    targetEntityTypes: ['iam.subject'],
    cardinality: 'ZERO_OR_ONE',
  });
  assert.deepEqual(definitions.find((definition) => definition.key === 'service_agreement'), {
    key: 'service_agreement',
    label: 'Service agreement',
    sourceEntityType: 'crm.case',
    targetEntityTypes: ['crm.agreement'],
    cardinality: 'ZERO_OR_ONE',
  });

  // The neutral engine and a pack that does not declare this relationship do
  // not manufacture a provider role.
  assert.deepEqual(resolveRelationshipDefinitions(null), []);
  assert.equal(
    resolveRelationshipDefinitions(LEXFLOW_PACK, 'crm.case').some((d) => d.key === 'assigned_agent'),
    false,
  );
});

test('management-plane pack description exposes Relationship Fabric declarations', () => {
  const acme = describeIndustryPack(ACME_CORP_PACK);
  assert.equal(acme.relationshipDefinitions.find((d) => d.key === 'assigned_agent')?.label, 'Assigned agent');
});

test('ACME Corp lifecycle Domain Events are Pack semantics, not workflow hardcoding', () => {
  assert.deepEqual(resolveCaseLifecycleEvent(ACME_CORP_PACK, 'INTAKE'), {
    stageKey: 'INTAKE',
    eventType: 'ServiceRequest.NewRequestEntered',
    eventVersion: 1,
  });
  assert.deepEqual(resolveCaseLifecycleEvent(ACME_CORP_PACK, 'RESOLVED'), {
    stageKey: 'RESOLVED',
    eventType: 'ServiceRequest.Completed',
    eventVersion: 1,
  });
  assert.equal(resolveCaseLifecycleEvent(LEXFLOW_PACK, 'RESOLVED'), null);
  assert.equal(resolveCaseLifecycleEvent(null, 'RESOLVED'), null);
});

test('ACME Corp follow-up is a governed Pack rule with runtime bindings', () => {
  const rules = resolveGovernedActionRules(ACME_CORP_PACK, 'ServiceRequest.Completed');
  assert.equal(rules.length, 1);
  const rule = rules[0]!;
  assert.ok(rule);
  assert.equal(rule.ruleKey, 'acme-corp.service-request.completed.client-follow-up');
  assert.equal(rule.executorClass, 'SCHEDULE');
  assert.equal(rule.actionKey, 'client.follow_up.schedule');

  const configuration = rule.configuration as any;
  assert.deepEqual(configuration.delaySeconds, { kind: 'LITERAL', value: 259200 });
  assert.deepEqual(configuration.target.executorClass, { kind: 'LITERAL', value: 'COMMUNICATE' });
  assert.equal(configuration.target.actionKey.value, 'client.follow_up');

  assert.deepEqual(
    resolveGovernedActionRules(LEXFLOW_PACK, 'ServiceRequest.Completed'),
    [],
  );
});
