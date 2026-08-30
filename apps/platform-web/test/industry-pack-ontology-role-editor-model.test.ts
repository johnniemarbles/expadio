import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDraftOntologyRolesEditorState,
  draftOntologyRolesStateFromDefinition,
  hasDraftOntologyRoleErrors,
  validateDraftOntologyRolesEditorState,
} from '../app/(shell)/configuration/industry-packs/drafts/[verticalKey]/[version]/ontology-role-editor-model.ts';

test('relationship-role editor initializes every canonical relationship concept', () => {
  const state = draftOntologyRolesStateFromDefinition({
    caseOntologyRoles: {
      'crm.contact': 'Patient treated',
    },
  });

  assert.deepEqual(state.roles.map((entry) => entry.conceptKey), [
    'crm.account',
    'crm.contact',
    'crm.agreement',
  ]);
  assert.equal(
    state.roles.find((entry) => entry.conceptKey === 'crm.contact')?.role,
    'Patient treated',
  );
  assert.equal(
    state.roles.find((entry) => entry.conceptKey === 'crm.account')?.role,
    '',
  );
});

test('relationship-role editor accepts canonical unique role overrides and blank fallbacks', () => {
  const errors = validateDraftOntologyRolesEditorState({
    roles: [
      { conceptKey: 'crm.account', role: '' },
      { conceptKey: 'crm.contact', role: 'Patient treated' },
      { conceptKey: 'crm.agreement', role: 'Governed by care plan' },
    ],
  });

  assert.equal(hasDraftOntologyRoleErrors(errors), false);
  assert.deepEqual(errors, {});
});

test('relationship-role editor rejects duplicate concepts and untrimmed role text', () => {
  const errors = validateDraftOntologyRolesEditorState({
    roles: [
      { conceptKey: 'crm.contact', role: ' Patient treated ' },
      { conceptKey: 'crm.contact', role: 'Duplicate' },
    ],
  });

  assert.equal(hasDraftOntologyRoleErrors(errors), true);
  assert.ok(errors.roles?.[0]);
  assert.ok(errors.roles?.[1]);
});

test('relationship-role editor persists only explicit overrides while preserving unrelated Pack sections', () => {
  const terminology = { keep: true };
  const definition = {
    verticalKey: 'dentex',
    terminology,
    caseOntologyRoles: {
      'crm.account': 'Old account role',
      'crm.contact': 'Old contact role',
    },
    caseSchema: { version: 1, fields: [] },
  };

  const merged = applyDraftOntologyRolesEditorState(definition, {
    roles: [
      { conceptKey: 'crm.account', role: '' },
      { conceptKey: 'crm.contact', role: 'Patient treated' },
      { conceptKey: 'crm.agreement', role: 'Governed by care plan' },
    ],
  });

  assert.strictEqual(merged.terminology, terminology);
  assert.strictEqual(merged.caseSchema, definition.caseSchema);
  assert.deepEqual(merged.caseOntologyRoles, {
    'crm.contact': 'Patient treated',
    'crm.agreement': 'Governed by care plan',
  });
});

test('clearing all relationship roles removes the optional override section', () => {
  const merged = applyDraftOntologyRolesEditorState({
    caseOntologyRoles: {
      'crm.contact': 'Patient treated',
    },
  }, {
    roles: [
      { conceptKey: 'crm.account', role: '' },
      { conceptKey: 'crm.contact', role: '' },
      { conceptKey: 'crm.agreement', role: '' },
    ],
  });

  assert.equal('caseOntologyRoles' in merged, false);
});
