export const AI_OPERATIONS = [
  'GENERATE',
  'CLASSIFY',
  'SUMMARIZE',
  'EXTRACT',
  'EMBED',
  'RERANK',
  'VISION_ANALYZE',
  'TRANSLATE',
] as const;

export type AiOperation = (typeof AI_OPERATIONS)[number];

export interface AiInvocationIntent {
  readonly invocationId: string;
  readonly tenantId: string;
  readonly operation: AiOperation;
  readonly purpose: string;
  readonly inputReference: string;
  readonly contextReference?: string;
  readonly promptConfiguration: {
    readonly key: string;
    readonly version: number;
  };
  readonly governance: {
    readonly requiredResidencyTags: readonly string[];
    readonly requiredComplianceTags: readonly string[];
    readonly maximumCostMinorUnits?: number;
  };
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly requestedAt: string;
}

export interface AiGateway {
  /**
   * Returns an observation or proposal. The gateway has no domain-mutation
   * method; callers must validate and submit a separate authorized command.
   */
  invoke(intent: AiInvocationIntent): Promise<AiProposal>;
}

export interface AiProposal {
  readonly invocationId: string;
  readonly tenantId: string;
  readonly status: 'OBSERVATION' | 'PROPOSAL';
  readonly outputReference: string;
  readonly confidence?: number;
  readonly provenance: AiProvenance;
}

export interface AiProvenance {
  readonly connectorKey: string;
  readonly providerKey: string;
  readonly modelKey: string;
  readonly promptConfigurationKey: string;
  readonly promptConfigurationVersion: number;
  readonly sourceReferences: readonly string[];
  readonly processedAt: string;
  readonly region?: string;
  /** Reconciled/authoritative cost only. */
  readonly costMinorUnits?: number;
  /** Provider-usage-derived estimate; never billing evidence. */
  readonly estimatedCostMinorUnits?: number;
  readonly providerUsage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
}

export type AiContractValidationCode =
  | 'AI_INVOCATION_ID_REQUIRED'
  | 'AI_OPERATION_INVALID'
  | 'AI_TENANT_REQUIRED'
  | 'AI_PURPOSE_REQUIRED'
  | 'AI_INPUT_REFERENCE_REQUIRED'
  | 'AI_CONTEXT_REFERENCE_INVALID'
  | 'AI_PROMPT_KEY_REQUIRED'
  | 'AI_PROMPT_VERSION_INVALID'
  | 'AI_IDEMPOTENCY_KEY_REQUIRED'
  | 'AI_CORRELATION_ID_REQUIRED'
  | 'AI_REQUESTED_AT_INVALID'
  | 'AI_COST_LIMIT_INVALID'
  | 'AI_GOVERNANCE_TAGS_INVALID'
  | 'AI_PROPOSAL_INVOCATION_MISMATCH'
  | 'AI_PROPOSAL_TENANT_MISMATCH'
  | 'AI_OUTPUT_REFERENCE_REQUIRED'
  | 'AI_CONFIDENCE_INVALID'
  | 'AI_PROVENANCE_REQUIRED'
  | 'AI_PROVENANCE_PROMPT_MISMATCH'
  | 'AI_PROVENANCE_SOURCE_REQUIRED'
  | 'AI_PROVENANCE_PROCESSED_AT_INVALID'
  | 'AI_PROVENANCE_COST_INVALID'
  | 'AI_PROVENANCE_ESTIMATED_COST_INVALID'
  | 'AI_PROVENANCE_USAGE_INVALID';

export interface AiContractValidationIssue {
  readonly code: AiContractValidationCode;
  readonly path: string;
}

export type AiContractValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly AiContractValidationIssue[];
    };

export function validateAiInvocationIntent(
  intent: AiInvocationIntent,
): AiContractValidationResult {
  const issues: AiContractValidationIssue[] = [];
  const runtime = intent as unknown as Record<string, unknown>;

  required(runtime.invocationId, 'AI_INVOCATION_ID_REQUIRED', 'invocationId', issues);
  if (
    typeof runtime.operation !== 'string'
    || !AI_OPERATIONS.includes(runtime.operation as AiOperation)
  ) {
    issues.push({ code: 'AI_OPERATION_INVALID', path: 'operation' });
  }
  required(runtime.tenantId, 'AI_TENANT_REQUIRED', 'tenantId', issues);
  required(runtime.purpose, 'AI_PURPOSE_REQUIRED', 'purpose', issues);
  required(
    runtime.inputReference,
    'AI_INPUT_REFERENCE_REQUIRED',
    'inputReference',
    issues,
  );

  if (
    runtime.contextReference !== undefined
    && (
      typeof runtime.contextReference !== 'string'
      || runtime.contextReference.trim() === ''
    )
  ) {
    issues.push({
      code: 'AI_CONTEXT_REFERENCE_INVALID',
      path: 'contextReference',
    });
  }

  const prompt = isRecord(runtime.promptConfiguration)
    ? runtime.promptConfiguration
    : undefined;
  required(
    prompt?.key,
    'AI_PROMPT_KEY_REQUIRED',
    'promptConfiguration.key',
    issues,
  );
  if (
    typeof prompt?.version !== 'number'
    || !Number.isInteger(prompt.version)
    || prompt.version <= 0
  ) {
    issues.push({
      code: 'AI_PROMPT_VERSION_INVALID',
      path: 'promptConfiguration.version',
    });
  }

  required(
    runtime.idempotencyKey,
    'AI_IDEMPOTENCY_KEY_REQUIRED',
    'idempotencyKey',
    issues,
  );
  required(
    runtime.correlationId,
    'AI_CORRELATION_ID_REQUIRED',
    'correlationId',
    issues,
  );
  if (!validInstant(runtime.requestedAt)) {
    issues.push({ code: 'AI_REQUESTED_AT_INVALID', path: 'requestedAt' });
  }

  const governance = isRecord(runtime.governance)
    ? runtime.governance
    : undefined;
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
      code: 'AI_COST_LIMIT_INVALID',
      path: 'governance.maximumCostMinorUnits',
    });
  }

  if (
    governance === undefined
    || !validStringArray(governance.requiredResidencyTags)
    || !validStringArray(governance.requiredComplianceTags)
  ) {
    issues.push({
      code: 'AI_GOVERNANCE_TAGS_INVALID',
      path: 'governance',
    });
  }

  return result(issues);
}

export function validateAiProposal(
  intent: AiInvocationIntent,
  proposal: AiProposal,
): AiContractValidationResult {
  const issues: AiContractValidationIssue[] = [];
  const runtime = proposal as unknown as Record<string, unknown>;
  const provenance = isRecord(runtime.provenance)
    ? runtime.provenance
    : undefined;

  if (runtime.invocationId !== intent.invocationId) {
    issues.push({
      code: 'AI_PROPOSAL_INVOCATION_MISMATCH',
      path: 'invocationId',
    });
  }
  if (runtime.tenantId !== intent.tenantId) {
    issues.push({ code: 'AI_PROPOSAL_TENANT_MISMATCH', path: 'tenantId' });
  }
  required(
    runtime.outputReference,
    'AI_OUTPUT_REFERENCE_REQUIRED',
    'outputReference',
    issues,
  );

  const confidence = runtime.confidence;
  if (
    confidence !== undefined
    && (
      typeof confidence !== 'number'
      || !Number.isFinite(confidence)
      || confidence < 0
      || confidence > 1
    )
  ) {
    issues.push({ code: 'AI_CONFIDENCE_INVALID', path: 'confidence' });
  }

  for (const [path, value] of [
    ['provenance.connectorKey', provenance?.connectorKey],
    ['provenance.providerKey', provenance?.providerKey],
    ['provenance.modelKey', provenance?.modelKey],
  ] as const) {
    required(value, 'AI_PROVENANCE_REQUIRED', path, issues);
  }

  if (
    provenance?.promptConfigurationKey !== intent.promptConfiguration.key
    || provenance?.promptConfigurationVersion !== intent.promptConfiguration.version
  ) {
    issues.push({
      code: 'AI_PROVENANCE_PROMPT_MISMATCH',
      path: 'provenance.promptConfiguration',
    });
  }

  if (
    provenance === undefined
    || !validNonBlankStringArray(provenance.sourceReferences)
  ) {
    issues.push({
      code: 'AI_PROVENANCE_SOURCE_REQUIRED',
      path: 'provenance.sourceReferences',
    });
  }

  if (!validInstant(provenance?.processedAt)) {
    issues.push({
      code: 'AI_PROVENANCE_PROCESSED_AT_INVALID',
      path: 'provenance.processedAt',
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
      code: 'AI_PROVENANCE_COST_INVALID',
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
      code: 'AI_PROVENANCE_ESTIMATED_COST_INVALID',
      path: 'provenance.estimatedCostMinorUnits',
    });
  }

  const usage = provenance?.providerUsage;
  if (
    usage !== undefined
    && (
      !isRecord(usage)
      || Object.values(usage).some(
        (value) =>
          value !== undefined
          && (
            typeof value !== 'number'
            || !Number.isInteger(value)
            || value < 0
          ),
      )
    )
  ) {
    issues.push({
      code: 'AI_PROVENANCE_USAGE_INVALID',
      path: 'provenance.providerUsage',
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

function required(
  value: unknown,
  code: AiContractValidationCode,
  path: string,
  issues: AiContractValidationIssue[],
): void {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push({ code, path });
  }
}

function validInstant(value: unknown): boolean {
  return typeof value === 'string'
    && value.trim() !== ''
    && Number.isFinite(Date.parse(value));
}

function result(
  issues: AiContractValidationIssue[],
): AiContractValidationResult {
  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}

export * from './routing.ts';

export * from './jobs.ts';

export * from './job-repository.ts';

export * from './gemini-adapter.ts';

export * from './openai-adapter.ts';

export * from './input-resolution.ts';
