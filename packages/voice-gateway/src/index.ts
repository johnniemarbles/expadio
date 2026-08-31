export const VOICE_INTELLIGENCE_OPERATIONS = [
  'TRANSCRIBE',
  'SYNTHESIZE',
  'STREAM_CONVERSATION',
] as const;

export type VoiceIntelligenceOperation =
  (typeof VOICE_INTELLIGENCE_OPERATIONS)[number];

export interface VoiceIntelligenceIntent {
  readonly requestId: string;
  readonly tenantId: string;
  readonly callId: string;
  readonly operation: VoiceIntelligenceOperation;
  readonly purpose: string;
  /** Audio, transcript, or synthesis-input reference; never raw media. */
  readonly inputReference: string;
  readonly languageTag: string;
  readonly governance: {
    readonly recordingConsentEvidenceReference?: string;
    readonly callerDisclosureEvidenceReference?: string;
    readonly recordingRetentionPolicy: VersionedVoicePolicyReference;
    readonly transcriptRetentionPolicy: VersionedVoicePolicyReference;
    readonly redactionPolicy: VersionedVoicePolicyReference;
    readonly jurisdictionTags: readonly string[];
    readonly requiredResidencyTags: readonly string[];
    readonly requiredComplianceTags: readonly string[];
    readonly maximumCostMinorUnits?: number;
  };
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly requestedAt: string;
}

export interface VersionedVoicePolicyReference {
  readonly key: string;
  readonly version: number;
}

export interface VoiceGateway {
  invoke(intent: VoiceIntelligenceIntent): Promise<VoiceIntelligenceObservation>;
}

export interface VoiceIntelligenceObservation {
  readonly requestId: string;
  readonly tenantId: string;
  readonly callId: string;
  readonly operation: VoiceIntelligenceOperation;
  readonly outputReference: string;
  readonly provenance: VoiceIntelligenceProvenance;
}

export interface VoiceIntelligenceProvenance {
  readonly connectorKey: string;
  readonly providerKey: string;
  readonly modelKey: string;
  readonly sourceReferences: readonly string[];
  readonly processedAt: string;
  readonly region?: string;
  readonly audioDurationMilliseconds?: number;
  /** Reconciled/authoritative cost only. */
  readonly costMinorUnits?: number;
  /** Provider-usage-derived estimate; never billing evidence. */
  readonly estimatedCostMinorUnits?: number;
}

export type VoiceContractValidationCode =
  | 'VOICE_REQUEST_ID_REQUIRED'
  | 'VOICE_OPERATION_INVALID'
  | 'VOICE_TENANT_REQUIRED'
  | 'VOICE_CALL_ID_REQUIRED'
  | 'VOICE_PURPOSE_REQUIRED'
  | 'VOICE_INPUT_REFERENCE_REQUIRED'
  | 'VOICE_LANGUAGE_REQUIRED'
  | 'VOICE_RECORDING_CONSENT_EVIDENCE_REQUIRED'
  | 'VOICE_POLICY_REFERENCE_INVALID'
  | 'VOICE_JURISDICTION_REQUIRED'
  | 'VOICE_IDEMPOTENCY_REQUIRED'
  | 'VOICE_CORRELATION_ID_REQUIRED'
  | 'VOICE_REQUESTED_AT_INVALID'
  | 'VOICE_COST_LIMIT_INVALID'
  | 'VOICE_GOVERNANCE_TAGS_INVALID'
  | 'VOICE_OBSERVATION_IDENTITY_MISMATCH'
  | 'VOICE_OUTPUT_REFERENCE_REQUIRED'
  | 'VOICE_PROVENANCE_REQUIRED'
  | 'VOICE_PROVENANCE_SOURCE_REQUIRED'
  | 'VOICE_PROCESSED_AT_INVALID'
  | 'VOICE_AUDIO_DURATION_INVALID'
  | 'VOICE_COST_INVALID'
  | 'VOICE_ESTIMATED_COST_INVALID';

export interface VoiceContractValidationIssue {
  readonly code: VoiceContractValidationCode;
  readonly path: string;
}

export type VoiceContractValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly VoiceContractValidationIssue[];
    };

export function validateVoiceIntelligenceIntent(
  intent: VoiceIntelligenceIntent,
): VoiceContractValidationResult {
  const issues: VoiceContractValidationIssue[] = [];
  const runtime = intent as unknown as Record<string, unknown>;

  required(runtime.requestId, 'VOICE_REQUEST_ID_REQUIRED', 'requestId', issues);
  if (
    typeof runtime.operation !== 'string'
    || !VOICE_INTELLIGENCE_OPERATIONS.includes(
      runtime.operation as VoiceIntelligenceOperation,
    )
  ) {
    issues.push({ code: 'VOICE_OPERATION_INVALID', path: 'operation' });
  }
  required(runtime.tenantId, 'VOICE_TENANT_REQUIRED', 'tenantId', issues);
  required(runtime.callId, 'VOICE_CALL_ID_REQUIRED', 'callId', issues);
  required(runtime.purpose, 'VOICE_PURPOSE_REQUIRED', 'purpose', issues);
  required(
    runtime.inputReference,
    'VOICE_INPUT_REFERENCE_REQUIRED',
    'inputReference',
    issues,
  );
  required(runtime.languageTag, 'VOICE_LANGUAGE_REQUIRED', 'languageTag', issues);

  const governance = isRecord(runtime.governance)
    ? runtime.governance
    : undefined;
  const operation = runtime.operation;

  if (
    (operation === 'TRANSCRIBE' || operation === 'STREAM_CONVERSATION')
    && !nonBlank(governance?.recordingConsentEvidenceReference)
  ) {
    issues.push({
      code: 'VOICE_RECORDING_CONSENT_EVIDENCE_REQUIRED',
      path: 'governance.recordingConsentEvidenceReference',
    });
  }

  for (const [path, policy] of [
    [
      'governance.recordingRetentionPolicy',
      governance?.recordingRetentionPolicy,
    ],
    [
      'governance.transcriptRetentionPolicy',
      governance?.transcriptRetentionPolicy,
    ],
    ['governance.redactionPolicy', governance?.redactionPolicy],
  ] as const) {
    if (!validPolicyReference(policy)) {
      issues.push({ code: 'VOICE_POLICY_REFERENCE_INVALID', path });
    }
  }

  if (!validNonBlankStringArray(governance?.jurisdictionTags)) {
    issues.push({
      code: 'VOICE_JURISDICTION_REQUIRED',
      path: 'governance.jurisdictionTags',
    });
  }

  if (
    governance === undefined
    || !validStringArray(governance.requiredResidencyTags)
    || !validStringArray(governance.requiredComplianceTags)
  ) {
    issues.push({
      code: 'VOICE_GOVERNANCE_TAGS_INVALID',
      path: 'governance',
    });
  }

  required(
    runtime.idempotencyKey,
    'VOICE_IDEMPOTENCY_REQUIRED',
    'idempotencyKey',
    issues,
  );
  required(
    runtime.correlationId,
    'VOICE_CORRELATION_ID_REQUIRED',
    'correlationId',
    issues,
  );
  if (!validInstant(runtime.requestedAt)) {
    issues.push({ code: 'VOICE_REQUESTED_AT_INVALID', path: 'requestedAt' });
  }

  const maximumCost = governance?.maximumCostMinorUnits;
  if (
    maximumCost !== undefined
    && (
      typeof maximumCost !== 'number'
      || !Number.isInteger(maximumCost)
      || maximumCost < 0
    )
  ) {
    issues.push({
      code: 'VOICE_COST_LIMIT_INVALID',
      path: 'governance.maximumCostMinorUnits',
    });
  }

  return result(issues);
}

export function validateVoiceIntelligenceObservation(
  intent: VoiceIntelligenceIntent,
  observation: VoiceIntelligenceObservation,
): VoiceContractValidationResult {
  const issues: VoiceContractValidationIssue[] = [];
  const runtime = observation as unknown as Record<string, unknown>;
  const provenance = isRecord(runtime.provenance)
    ? runtime.provenance
    : undefined;

  if (
    runtime.requestId !== intent.requestId
    || runtime.tenantId !== intent.tenantId
    || runtime.callId !== intent.callId
    || runtime.operation !== intent.operation
  ) {
    issues.push({
      code: 'VOICE_OBSERVATION_IDENTITY_MISMATCH',
      path: 'observation',
    });
  }

  required(
    runtime.outputReference,
    'VOICE_OUTPUT_REFERENCE_REQUIRED',
    'outputReference',
    issues,
  );

  for (const [path, value] of [
    ['provenance.connectorKey', provenance?.connectorKey],
    ['provenance.providerKey', provenance?.providerKey],
    ['provenance.modelKey', provenance?.modelKey],
  ] as const) {
    required(value, 'VOICE_PROVENANCE_REQUIRED', path, issues);
  }

  if (
    provenance === undefined
    || !validNonBlankStringArray(provenance.sourceReferences)
  ) {
    issues.push({
      code: 'VOICE_PROVENANCE_SOURCE_REQUIRED',
      path: 'provenance.sourceReferences',
    });
  }

  if (!validInstant(provenance?.processedAt)) {
    issues.push({
      code: 'VOICE_PROCESSED_AT_INVALID',
      path: 'provenance.processedAt',
    });
  }

  const duration = provenance?.audioDurationMilliseconds;
  if (
    duration !== undefined
    && (
      typeof duration !== 'number'
      || !Number.isInteger(duration)
      || duration < 0
    )
  ) {
    issues.push({
      code: 'VOICE_AUDIO_DURATION_INVALID',
      path: 'provenance.audioDurationMilliseconds',
    });
  }

  const cost = provenance?.costMinorUnits;
  if (
    cost !== undefined
    && (
      typeof cost !== 'number'
      || !Number.isInteger(cost)
      || cost < 0
    )
  ) {
    issues.push({
      code: 'VOICE_COST_INVALID',
      path: 'provenance.costMinorUnits',
    });
  }

  const estimatedCost = provenance?.estimatedCostMinorUnits;
  if (
    estimatedCost !== undefined
    && (
      typeof estimatedCost !== 'number'
      || !Number.isInteger(estimatedCost)
      || estimatedCost < 0
    )
  ) {
    issues.push({
      code: 'VOICE_ESTIMATED_COST_INVALID',
      path: 'provenance.estimatedCostMinorUnits',
    });
  }

  return result(issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validStringArray(value: unknown): boolean {
  return Array.isArray(value)
    && value.every(
      (entry) => typeof entry === 'string' && entry.trim() !== '',
    );
}

function validNonBlankStringArray(value: unknown): boolean {
  return validStringArray(value) && (value as readonly unknown[]).length > 0;
}

function validPolicyReference(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.key === 'string'
    && value.key.trim() !== ''
    && typeof value.version === 'number'
    && Number.isInteger(value.version)
    && value.version > 0;
}

function required(
  value: unknown,
  code: VoiceContractValidationCode,
  path: string,
  issues: VoiceContractValidationIssue[],
): void {
  if (value.trim() === '') issues.push({ code, path });
}

function nonBlank(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function validInstant(value: unknown): boolean {
  return typeof value === 'string'
    && value.trim() !== ''
    && Number.isFinite(Date.parse(value));
}

function result(
  issues: VoiceContractValidationIssue[],
): VoiceContractValidationResult {
  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}

export * from './routing.ts';

export * from './deepgram-stt-adapter.ts';

export * from './elevenlabs-tts-adapter.ts';

export * from './input-resolution.ts';
