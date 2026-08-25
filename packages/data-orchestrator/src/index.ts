export type IntelligenceStage =
  | 'INGEST'
  | 'EXTRACT'
  | 'TRANSFORM'
  | 'RESOLVE_ENTITIES'
  | 'ENRICH'
  | 'CLASSIFY'
  | 'EMBED'
  | 'INDEX'
  | 'VALIDATE_ONTOLOGY'
  | 'APPLY_POLICY'
  | 'PROPOSE_PROJECTION'
  | 'PROPOSE_WORKFLOW_TRIGGER';

export interface VersionedIntelligenceConfigurationReference {
  readonly key: string;
  readonly version: number;
}

export interface DataOrchestrationIntent {
  readonly workId: string;
  readonly tenantId: string;
  readonly purpose: string;
  readonly sourceEventReference: string;
  readonly stages: readonly IntelligenceStage[];
  readonly ontology: VersionedIntelligenceConfigurationReference;
  readonly policies: readonly VersionedIntelligenceConfigurationReference[];
  readonly idempotencyKey: string;
  readonly requestedBySubjectId: string;
  readonly requestedAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export interface DataIntelligenceOrchestrator {
  execute(
    intent: DataOrchestrationIntent,
  ): Promise<DataOrchestrationObservation>;
}

export interface DataOrchestrationObservation {
  readonly workId: string;
  readonly tenantId: string;
  readonly status: 'OBSERVATION' | 'PROPOSAL';
  readonly stageOutputs: readonly DataOrchestrationStageOutput[];
  readonly provenance: {
    readonly sourceReferences: readonly string[];
    readonly completedAt: string;
  };
}

export interface DataOrchestrationStageOutput {
  readonly stage: IntelligenceStage;
  readonly outputReference: string;
}

export type DataOrchestrationValidationCode =
  | 'DATA_WORK_ID_REQUIRED'
  | 'DATA_TENANT_REQUIRED'
  | 'DATA_PURPOSE_REQUIRED'
  | 'DATA_SOURCE_REFERENCE_REQUIRED'
  | 'DATA_STAGE_REQUIRED'
  | 'DATA_STAGE_DUPLICATE'
  | 'DATA_STAGE_ORDER_INVALID'
  | 'DATA_PROPOSAL_GOVERNANCE_REQUIRED'
  | 'DATA_ONTOLOGY_REFERENCE_INVALID'
  | 'DATA_POLICY_REFERENCE_INVALID'
  | 'DATA_IDEMPOTENCY_REQUIRED'
  | 'DATA_REQUESTER_REQUIRED'
  | 'DATA_REQUESTED_AT_INVALID'
  | 'DATA_CORRELATION_REQUIRED'
  | 'DATA_EVIDENCE_REQUIRED'
  | 'DATA_OBSERVATION_IDENTITY_MISMATCH'
  | 'DATA_STAGE_OUTPUT_DUPLICATE'
  | 'DATA_STAGE_OUTPUT_UNREQUESTED'
  | 'DATA_STAGE_OUTPUT_REFERENCE_REQUIRED'
  | 'DATA_PROVENANCE_SOURCE_REQUIRED'
  | 'DATA_COMPLETED_AT_INVALID';

export interface DataOrchestrationValidationIssue {
  readonly code: DataOrchestrationValidationCode;
  readonly path: string;
}

export type DataOrchestrationValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly DataOrchestrationValidationIssue[];
    };

const STAGE_ORDER: Readonly<Record<IntelligenceStage, number>> = {
  INGEST: 0,
  EXTRACT: 1,
  TRANSFORM: 2,
  RESOLVE_ENTITIES: 3,
  ENRICH: 4,
  CLASSIFY: 5,
  EMBED: 6,
  INDEX: 7,
  VALIDATE_ONTOLOGY: 8,
  APPLY_POLICY: 9,
  PROPOSE_PROJECTION: 10,
  PROPOSE_WORKFLOW_TRIGGER: 11,
};

export function validateDataOrchestrationIntent(
  intent: DataOrchestrationIntent,
): DataOrchestrationValidationResult {
  const issues: DataOrchestrationValidationIssue[] = [];
  required(intent.workId, 'DATA_WORK_ID_REQUIRED', 'workId', issues);
  required(intent.tenantId, 'DATA_TENANT_REQUIRED', 'tenantId', issues);
  required(intent.purpose, 'DATA_PURPOSE_REQUIRED', 'purpose', issues);
  required(
    intent.sourceEventReference,
    'DATA_SOURCE_REFERENCE_REQUIRED',
    'sourceEventReference',
    issues,
  );
  if (intent.stages.length === 0) {
    issues.push({ code: 'DATA_STAGE_REQUIRED', path: 'stages' });
  }

  const stages = new Set<IntelligenceStage>();
  let priorOrder = -1;
  intent.stages.forEach((stage, index) => {
    if (stages.has(stage)) {
      issues.push({
        code: 'DATA_STAGE_DUPLICATE',
        path: `stages[${index}]`,
      });
    }
    if (STAGE_ORDER[stage] <= priorOrder) {
      issues.push({
        code: 'DATA_STAGE_ORDER_INVALID',
        path: `stages[${index}]`,
      });
    }
    stages.add(stage);
    priorOrder = STAGE_ORDER[stage];
  });

  if (
    (stages.has('PROPOSE_PROJECTION')
      || stages.has('PROPOSE_WORKFLOW_TRIGGER'))
    && (!stages.has('VALIDATE_ONTOLOGY') || !stages.has('APPLY_POLICY'))
  ) {
    issues.push({
      code: 'DATA_PROPOSAL_GOVERNANCE_REQUIRED',
      path: 'stages',
    });
  }

  validateReference(
    intent.ontology,
    'DATA_ONTOLOGY_REFERENCE_INVALID',
    'ontology',
    issues,
  );
  intent.policies.forEach((policy, index) => {
    validateReference(
      policy,
      'DATA_POLICY_REFERENCE_INVALID',
      `policies[${index}]`,
      issues,
    );
  });
  required(
    intent.idempotencyKey,
    'DATA_IDEMPOTENCY_REQUIRED',
    'idempotencyKey',
    issues,
  );
  required(
    intent.requestedBySubjectId,
    'DATA_REQUESTER_REQUIRED',
    'requestedBySubjectId',
    issues,
  );
  if (!validInstant(intent.requestedAt)) {
    issues.push({ code: 'DATA_REQUESTED_AT_INVALID', path: 'requestedAt' });
  }
  required(
    intent.correlationId,
    'DATA_CORRELATION_REQUIRED',
    'correlationId',
    issues,
  );
  if (intent.evidenceRefs.length === 0) {
    issues.push({ code: 'DATA_EVIDENCE_REQUIRED', path: 'evidenceRefs' });
  }

  return result(issues);
}

export function validateDataOrchestrationObservation(
  intent: DataOrchestrationIntent,
  observation: DataOrchestrationObservation,
): DataOrchestrationValidationResult {
  const issues: DataOrchestrationValidationIssue[] = [];
  if (
    observation.workId !== intent.workId
    || observation.tenantId !== intent.tenantId
  ) {
    issues.push({
      code: 'DATA_OBSERVATION_IDENTITY_MISMATCH',
      path: 'observation',
    });
  }

  const outputs = new Set<IntelligenceStage>();
  observation.stageOutputs.forEach((output, index) => {
    const path = `stageOutputs[${index}]`;
    if (outputs.has(output.stage)) {
      issues.push({ code: 'DATA_STAGE_OUTPUT_DUPLICATE', path });
    }
    if (!intent.stages.includes(output.stage)) {
      issues.push({ code: 'DATA_STAGE_OUTPUT_UNREQUESTED', path });
    }
    if (output.outputReference.trim() === '') {
      issues.push({
        code: 'DATA_STAGE_OUTPUT_REFERENCE_REQUIRED',
        path: `${path}.outputReference`,
      });
    }
    outputs.add(output.stage);
  });

  if (observation.provenance.sourceReferences.length === 0) {
    issues.push({
      code: 'DATA_PROVENANCE_SOURCE_REQUIRED',
      path: 'provenance.sourceReferences',
    });
  }
  if (!validInstant(observation.provenance.completedAt)) {
    issues.push({
      code: 'DATA_COMPLETED_AT_INVALID',
      path: 'provenance.completedAt',
    });
  }
  return result(issues);
}

function validateReference(
  reference: VersionedIntelligenceConfigurationReference,
  code:
    | 'DATA_ONTOLOGY_REFERENCE_INVALID'
    | 'DATA_POLICY_REFERENCE_INVALID',
  path: string,
  issues: DataOrchestrationValidationIssue[],
): void {
  if (
    reference.key.trim() === ''
    || !Number.isInteger(reference.version)
    || reference.version <= 0
  ) {
    issues.push({ code, path });
  }
}

function required(
  value: string,
  code: DataOrchestrationValidationCode,
  path: string,
  issues: DataOrchestrationValidationIssue[],
): void {
  if (value.trim() === '') issues.push({ code, path });
}

function validInstant(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function result(
  issues: DataOrchestrationValidationIssue[],
): DataOrchestrationValidationResult {
  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}
