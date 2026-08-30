import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDraftTerminologyEditorState,
  draftTerminologyStateFromDefinition,
  hasDraftTerminologyEditorErrors,
  terminologyIssueForPath,
  validateDraftTerminologyEditorState,
} from '../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/terminology-editor-model.ts';

const valid = {
  concepts: [{
    conceptKey: 'crm.contact',
    labels: [
      { locale: 'en', singular: 'Patient', plural: 'Patients' },
      { locale: 'fr', singular: 'Patient', plural: 'Patients' },
    ],
    aliases: ['client'],
  }],
};

test('terminology editor validates locale labels and aliases against the canonical validator', () => {
  const errors = validateDraftTerminologyEditorState(valid, 'en');
  assert.equal(hasDraftTerminologyEditorErrors(errors), false);
  assert.deepEqual(errors.issues, []);
});

test('terminology editor surfaces missing default-locale labels and duplicate locale or alias problems', () => {
  const errors = validateDraftTerminologyEditorState({
    concepts: [{
      conceptKey: 'crm.contact',
      labels: [
        { locale: 'fr', singular: 'Patient', plural: 'Patients' },
        { locale: 'FR', singular: 'Client', plural: 'Clients' },
      ],
      aliases: ['Client', ' client '],
    }],
  }, 'en');

  assert.equal(hasDraftTerminologyEditorErrors(errors), true);
  assert.ok(terminologyIssueForPath(errors, 'concepts[0].labels'));
  assert.ok(terminologyIssueForPath(errors, 'concepts[0].labels[1].locale'));
  assert.ok(terminologyIssueForPath(errors, 'concepts[0].aliases[1]'));
});

test('terminology editor trims vocabulary while preserving concept identity and unrelated Pack sections', () => {
  const profile = { keep: true };
  const definition = {
    verticalKey: 'dentex',
    profile,
    terminology: {
      defaultLocale: 'en',
      concepts: [{
        conceptKey: 'crm.contact',
        labels: [{ locale: 'en', singular: 'Contact', plural: 'Contacts' }],
      }],
    },
    caseSchema: { version: 1, fields: [] },
  };

  const initial = draftTerminologyStateFromDefinition(definition);
  assert.equal(initial.concepts[0]?.conceptKey, 'crm.contact');

  const merged = applyDraftTerminologyEditorState(definition, {
    concepts: [{
      conceptKey: 'crm.contact',
      labels: [{ locale: ' en ', singular: ' Patient ', plural: ' Patients ' }],
      aliases: [' client ', 'client'],
    }],
  });

  assert.strictEqual(merged.profile, profile);
  assert.strictEqual(merged.caseSchema, definition.caseSchema);
  assert.equal(merged.terminology.defaultLocale, 'en');
  assert.deepEqual(merged.terminology.concepts, [{
    conceptKey: 'crm.contact',
    labels: [{ locale: 'en', singular: 'Patient', plural: 'Patients' }],
    aliases: ['client'],
  }]);
});

test('terminology editor copies definition arrays instead of mutating them', () => {
  const definition = {
    terminology: {
      defaultLocale: 'en',
      concepts: [{
        conceptKey: 'crm.case',
        labels: [{ locale: 'en', singular: 'Case', plural: 'Cases' }],
        aliases: ['matter'],
      }],
    },
  };
  const state = draftTerminologyStateFromDefinition(definition);
  assert.notStrictEqual(state.concepts, definition.terminology.concepts);
  assert.notStrictEqual(state.concepts[0]?.labels, definition.terminology.concepts[0]?.labels);
  assert.notStrictEqual(state.concepts[0]?.aliases, definition.terminology.concepts[0]?.aliases);
});
