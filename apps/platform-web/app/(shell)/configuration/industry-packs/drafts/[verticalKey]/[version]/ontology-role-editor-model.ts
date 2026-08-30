import {
  CASE_RELATIONSHIP_CONCEPTS,
  type CaseRelationshipConcept,
} from '@expadio/industry-packs';

export interface DraftOntologyRoleState {
  readonly conceptKey: CaseRelationshipConcept;
  readonly role: string;
}

export interface DraftOntologyRolesEditorState {
  readonly roles: readonly DraftOntologyRoleState[];
}

export interface DraftOntologyRoleErrors {
  readonly roles?: Readonly<Record<number, string>>;
}

export interface DraftOntologyRolesDefinitionShape {
  readonly caseOntologyRoles?: Readonly<Record<string, string>>;
}

const ALLOWED = new Set<string>(CASE_RELATIONSHIP_CONCEPTS);

export function validateDraftOntologyRolesEditorState(
  state: DraftOntologyRolesEditorState,
): DraftOntologyRoleErrors {
  const errors: Record<number, string> = {};
  const seen = new Set<string>();

  state.roles.forEach((entry, index) => {
    if (!ALLOWED.has(entry.conceptKey)) {
      errors[index] = 'Use a canonical CRM relationship concept.';
      return;
    }
    if (seen.has(entry.conceptKey)) {
      errors[index] = 'Relationship concepts must be unique.';
      return;
    }
    seen.add(entry.conceptKey);

    if (entry.role !== entry.role.trim()) {
      errors[index] = 'Relationship role must not have leading or trailing whitespace.';
    }
  });

  return Object.keys(errors).length === 0 ? {} : { roles: errors };
}

export function hasDraftOntologyRoleErrors(
  errors: DraftOntologyRoleErrors,
): boolean {
  return errors.roles !== undefined && Object.keys(errors.roles).length > 0;
}

/**
 * Blank roles intentionally mean "use the neutral fallback"; only explicit,
 * canonical Pack overrides are persisted.
 */
export function applyDraftOntologyRolesEditorState<T extends DraftOntologyRolesDefinitionShape>(
  definition: T,
  state: DraftOntologyRolesEditorState,
): T {
  const caseOntologyRoles = Object.fromEntries(
    state.roles
      .map((entry) => [entry.conceptKey, entry.role.trim()] as const)
      .filter(([, role]) => role !== ''),
  );

  const { caseOntologyRoles: _previous, ...rest } = definition;
  return {
    ...rest,
    ...(Object.keys(caseOntologyRoles).length === 0 ? {} : { caseOntologyRoles }),
  } as T;
}

export function draftOntologyRolesStateFromDefinition(
  definition: DraftOntologyRolesDefinitionShape,
): DraftOntologyRolesEditorState {
  return {
    roles: CASE_RELATIONSHIP_CONCEPTS.map((conceptKey) => ({
      conceptKey,
      role: definition.caseOntologyRoles?.[conceptKey] ?? '',
    })),
  };
}
