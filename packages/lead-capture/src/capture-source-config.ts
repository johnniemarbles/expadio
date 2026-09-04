import {
  listInterestTypes,
  resolveInterestType,
  supportsPublicationMode,
  type PublicationMode,
  type RegistryInterestType,
  type RegistryOpportunityType,
} from './interest-type-registry.ts';

export type CaptureSourceMode = 'GENERIC' | 'INTEREST';

export interface CaptureSourceInterestSelectionInput {
  readonly interestType: RegistryInterestType;
  readonly opportunityType?: RegistryOpportunityType;
}

export interface CaptureSourceInterestSelection extends CaptureSourceInterestSelectionInput {
  readonly schemaKey: string;
  readonly qualificationProfileKey: string;
  readonly workflowBlueprintKey: string;
  readonly evidenceProfileKey: string;
  readonly defaultRoutingProfileKey: string;
}

export interface CaptureSourcePublicationConfigInput {
  readonly captureMode?: CaptureSourceMode;
  readonly publicationMode?: PublicationMode;
  readonly allowedInterests?: readonly CaptureSourceInterestSelectionInput[];
}

export interface CaptureSourcePublicationConfig {
  readonly captureMode: CaptureSourceMode;
  readonly publicationMode: PublicationMode;
  readonly allowedInterests: readonly CaptureSourceInterestSelection[];
}

export class CaptureSourceConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CaptureSourceConfigError';
    this.code = code;
  }
}

const DEFAULT_PUBLICATION_MODE: PublicationMode = 'JS_WIDGET';

function selectionKey(selection: CaptureSourceInterestSelectionInput): string {
  return selection.opportunityType ? `${selection.interestType}:${selection.opportunityType}` : selection.interestType;
}

/**
 * Normalize the brand-configurable source publication contract. This is the
 * source-level narrowing seam: Platform exposes the full InterestTypeRegistry,
 * while a brand source may publish only the interest/opportunity combinations
 * approved for that source and publication mode. Invalid or unsupported
 * combinations fail closed before a source is created or a payload is accepted.
 */
export function normalizeCaptureSourcePublicationConfig(
  input: CaptureSourcePublicationConfigInput = {},
): CaptureSourcePublicationConfig {
  const captureMode = input.captureMode ?? (input.allowedInterests?.length ? 'INTEREST' : 'GENERIC');
  if (captureMode !== 'GENERIC' && captureMode !== 'INTEREST') {
    throw new CaptureSourceConfigError('CAPTURE_SOURCE_MODE_INVALID', 'Unsupported capture source mode.');
  }

  const publicationMode = input.publicationMode ?? DEFAULT_PUBLICATION_MODE;
  const rawSelections = input.allowedInterests ?? [];

  if (captureMode === 'GENERIC') {
    if (rawSelections.length > 0) {
      throw new CaptureSourceConfigError(
        'CAPTURE_SOURCE_GENERIC_WITH_INTERESTS',
        'Generic capture sources cannot declare interest restrictions.',
      );
    }
    return { captureMode, publicationMode, allowedInterests: [] };
  }

  if (rawSelections.length === 0) {
    throw new CaptureSourceConfigError(
      'CAPTURE_SOURCE_INTERESTS_REQUIRED',
      'Interest capture sources must declare at least one allowed interest type.',
    );
  }
  if (rawSelections.length > 20) {
    throw new CaptureSourceConfigError(
      'CAPTURE_SOURCE_INTERESTS_TOO_MANY',
      'A capture source can declare at most 20 allowed interest combinations.',
    );
  }

  const seen = new Set<string>();
  const allowedInterests: CaptureSourceInterestSelection[] = [];
  for (const selection of rawSelections) {
    const entry = resolveInterestType(selection.interestType, selection.opportunityType);
    if (!entry) {
      throw new CaptureSourceConfigError(
        'CAPTURE_SOURCE_INTEREST_UNSUPPORTED',
        `Unsupported interest selection: ${selectionKey(selection)}.`,
      );
    }
    if (!supportsPublicationMode(selection.interestType, selection.opportunityType, publicationMode)) {
      throw new CaptureSourceConfigError(
        'CAPTURE_SOURCE_PUBLICATION_MODE_UNSUPPORTED',
        `${selectionKey(selection)} cannot be published through ${publicationMode}.`,
      );
    }
    const key = selectionKey(selection);
    if (seen.has(key)) continue;
    seen.add(key);
    allowedInterests.push({
      interestType: entry.interestType,
      ...(entry.opportunityType ? { opportunityType: entry.opportunityType } : {}),
      schemaKey: entry.schemaKey,
      qualificationProfileKey: entry.qualificationProfileKey,
      workflowBlueprintKey: entry.workflowBlueprintKey,
      evidenceProfileKey: entry.evidenceProfileKey,
      defaultRoutingProfileKey: entry.defaultRoutingProfileKey,
    });
  }

  return { captureMode, publicationMode, allowedInterests };
}

export function listCaptureSourceInterestOptions(): readonly CaptureSourceInterestSelection[] {
  return listInterestTypes().map((entry) => ({
    interestType: entry.interestType,
    ...(entry.opportunityType ? { opportunityType: entry.opportunityType } : {}),
    schemaKey: entry.schemaKey,
    qualificationProfileKey: entry.qualificationProfileKey,
    workflowBlueprintKey: entry.workflowBlueprintKey,
    evidenceProfileKey: entry.evidenceProfileKey,
    defaultRoutingProfileKey: entry.defaultRoutingProfileKey,
  }));
}

export function captureSubmissionAllowedBySourceConfig(
  config: CaptureSourcePublicationConfig,
  interest: CaptureSourceInterestSelectionInput | undefined,
): boolean {
  if (config.captureMode === 'GENERIC') return interest === undefined;
  if (!interest) return false;
  const key = selectionKey(interest);
  return config.allowedInterests.some((selection) => selectionKey(selection) === key);
}
