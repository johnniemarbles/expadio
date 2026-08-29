import {
  validateIndustryProfile,
  validatePresentationTerminology,
  type IndustryProfile,
  type PresentationTerminologyCatalogue,
} from '@expadio/business-config';
import type { IndustryPack } from './index.ts';

export type IndustryPackDefinitionValidationCode =
  | 'PACK_OBJECT_REQUIRED'
  | 'PACK_VERTICAL_KEY_INVALID'
  | 'PACK_VERTICAL_KEY_MISMATCH'
  | 'PACK_LABEL_REQUIRED'
  | 'PACK_PROFILE_INVALID'
  | 'PACK_TERMINOLOGY_INVALID'
  | 'PACK_CASE_SCHEMA_INVALID'
  | 'PACK_CASE_WORKFLOW_INVALID'
  | 'PACK_ONTOLOGY_ROLE_INVALID';

export interface IndustryPackDefinitionValidationIssue {
  readonly code: IndustryPackDefinitionValidationCode;
  readonly path: string;
  readonly detail?: string;
}

export type IndustryPackDefinitionValidationResult =
  | {
      readonly valid: true;
      readonly issues: readonly [];
      readonly definition: IndustryPack;
    }
  | {
      readonly valid: false;
      readonly issues: readonly IndustryPackDefinitionValidationIssue[];
    };

const CANONICAL_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CASE_STAGE_KEYS = ['INTAKE', 'IN_PROGRESS', 'REVIEW', 'RESOLVED'] as const;
const CASE_RELATIONSHIP_KEYS = ['crm.account', 'crm.contact', 'crm.agreement'] as const;

/**
 * Runtime validation for authored Industry Pack JSON.
 *
 * The repository port is intentionally typed and trusts callers. HTTP/API
 * boundaries must validate unknown JSON here before creating or updating a
 * governed authoring artifact.
 */
export function validateIndustryPackDefinition(
  input: unknown,
  expectedVerticalKey?: string,
): IndustryPackDefinitionValidationResult {
  const issues: IndustryPackDefinitionValidationIssue[] = [];
  if (!isRecord(input)) {
    return { valid: false, issues: [{ code: 'PACK_OBJECT_REQUIRED', path: '' }] };
  }

  const verticalKey = typeof input.verticalKey === 'string'
    ? input.verticalKey.trim().toLowerCase()
    : '';
  if (!CANONICAL_KEY.test(verticalKey)) {
    issues.push({ code: 'PACK_VERTICAL_KEY_INVALID', path: 'verticalKey' });
  }
  if (
    expectedVerticalKey !== undefined
    && verticalKey !== expectedVerticalKey.trim().toLowerCase()
  ) {
    issues.push({ code: 'PACK_VERTICAL_KEY_MISMATCH', path: 'verticalKey' });
  }

  if (typeof input.label !== 'string' || input.label.trim() === '') {
    issues.push({ code: 'PACK_LABEL_REQUIRED', path: 'label' });
  }

  const profile = parseIndustryProfile(input.profile);
  if (profile === null) {
    issues.push({ code: 'PACK_PROFILE_INVALID', path: 'profile' });
  } else {
    const result = validateIndustryProfile(profile);
    for (const issue of result.issues) {
      issues.push({
        code: 'PACK_PROFILE_INVALID',
        path: `profile.${issue.path}`,
        detail: issue.code,
      });
    }
    if (verticalKey !== '' && profile.industryKey.trim().toLowerCase() !== verticalKey) {
      issues.push({
        code: 'PACK_PROFILE_INVALID',
        path: 'profile.industryKey',
        detail: 'INDUSTRY_KEY_MUST_MATCH_VERTICAL_KEY',
      });
    }
  }

  const terminology = parseTerminology(input.terminology);
  if (terminology === null) {
    issues.push({ code: 'PACK_TERMINOLOGY_INVALID', path: 'terminology' });
  } else {
    const result = validatePresentationTerminology(terminology);
    for (const issue of result.issues) {
      issues.push({
        code: 'PACK_TERMINOLOGY_INVALID',
        path: `terminology.${issue.path}`,
        detail: issue.code,
      });
    }
  }

  if (input.caseSchema !== undefined && !validCaseSchema(input.caseSchema)) {
    issues.push({ code: 'PACK_CASE_SCHEMA_INVALID', path: 'caseSchema' });
  }
  if (input.caseWorkflow !== undefined && !validCaseWorkflow(input.caseWorkflow)) {
    issues.push({ code: 'PACK_CASE_WORKFLOW_INVALID', path: 'caseWorkflow' });
  }
  if (input.caseOntologyRoles !== undefined && !validOntologyRoles(input.caseOntologyRoles)) {
    issues.push({ code: 'PACK_ONTOLOGY_ROLE_INVALID', path: 'caseOntologyRoles' });
  }

  if (issues.length > 0 || profile === null || terminology === null) {
    return { valid: false, issues };
  }

  return {
    valid: true,
    issues: [],
    definition: {
      verticalKey,
      label: (input.label as string).trim(),
      profile,
      terminology,
      ...(input.caseWorkflow === undefined ? {} : { caseWorkflow: input.caseWorkflow as IndustryPack['caseWorkflow'] }),
      ...(input.caseSchema === undefined ? {} : { caseSchema: input.caseSchema as IndustryPack['caseSchema'] }),
      ...(input.caseOntologyRoles === undefined
        ? {}
        : { caseOntologyRoles: input.caseOntologyRoles as IndustryPack['caseOntologyRoles'] }),
    },
  };
}

function parseIndustryProfile(input: unknown): IndustryProfile | null {
  if (!isRecord(input)) return null;
  if (
    typeof input.industryKey !== 'string'
    || typeof input.label !== 'string'
    || !Array.isArray(input.components)
  ) return null;

  const components = [];
  for (const component of input.components) {
    if (
      !isRecord(component)
      || typeof component.kind !== 'string'
      || typeof component.key !== 'string'
      || typeof component.version !== 'number'
    ) return null;
    components.push({
      kind: component.kind as IndustryProfile['components'][number]['kind'],
      key: component.key,
      version: component.version,
    });
  }
  return {
    industryKey: input.industryKey,
    label: input.label,
    components,
  };
}

function parseTerminology(input: unknown): PresentationTerminologyCatalogue | null {
  if (!isRecord(input) || typeof input.defaultLocale !== 'string' || !Array.isArray(input.concepts)) {
    return null;
  }

  const concepts = [];
  for (const concept of input.concepts) {
    if (!isRecord(concept) || typeof concept.conceptKey !== 'string' || !Array.isArray(concept.labels)) {
      return null;
    }
    const labels = [];
    for (const label of concept.labels) {
      if (
        !isRecord(label)
        || typeof label.locale !== 'string'
        || typeof label.singular !== 'string'
        || typeof label.plural !== 'string'
      ) return null;
      labels.push({
        locale: label.locale,
        singular: label.singular,
        plural: label.plural,
      });
    }
    if (
      concept.aliases !== undefined
      && (!Array.isArray(concept.aliases) || concept.aliases.some((alias) => typeof alias !== 'string'))
    ) return null;
    concepts.push({
      conceptKey: concept.conceptKey,
      labels,
      ...(concept.aliases === undefined ? {} : { aliases: concept.aliases as string[] }),
    });
  }

  return { defaultLocale: input.defaultLocale, concepts };
}

function validCaseSchema(input: unknown): boolean {
  if (!isRecord(input) || !Number.isInteger(input.version) || Number(input.version) <= 0 || !Array.isArray(input.fields)) {
    return false;
  }
  const keys = new Set<string>();
  for (const field of input.fields) {
    if (!isRecord(field)) return false;
    if (
      typeof field.key !== 'string'
      || !CANONICAL_KEY.test(field.key)
      || keys.has(field.key)
      || typeof field.label !== 'string'
      || field.label.trim() === ''
      || !['text', 'number', 'select'].includes(String(field.type))
      || (field.required !== undefined && typeof field.required !== 'boolean')
    ) return false;
    keys.add(field.key);
    if (field.type === 'select') {
      if (
        !Array.isArray(field.options)
        || field.options.length === 0
        || field.options.some((option) => typeof option !== 'string' || option.trim() === '')
      ) return false;
    } else if (field.options !== undefined) {
      return false;
    }
  }
  return true;
}

function validCaseWorkflow(input: unknown): boolean {
  if (!isRecord(input) || typeof input.workType !== 'string' || input.workType.trim() === '' || !isRecord(input.stages)) {
    return false;
  }
  for (const key of CASE_STAGE_KEYS) {
    if (typeof input.stages[key] !== 'string' || String(input.stages[key]).trim() === '') return false;
  }
  for (const optional of ['decisionOutcomeLabels', 'stageGuidance'] as const) {
    if (input[optional] === undefined) continue;
    if (!isRecord(input[optional])) return false;
    for (const value of Object.values(input[optional])) {
      if (typeof value !== 'string' || value.trim() === '') return false;
    }
  }
  return true;
}

function validOntologyRoles(input: unknown): boolean {
  if (!isRecord(input)) return false;
  const allowed = new Set<string>(CASE_RELATIONSHIP_KEYS);
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key) || typeof value !== 'string' || value.trim() === '') return false;
  }
  return true;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
