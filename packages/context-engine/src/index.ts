export const CONTEXT_KINDS = [
  'ORGANIZATION',
  'TENANT',
  'PERSONA',
  'ROLE',
  'RELATIONSHIP',
  'TERRITORY',
  'CRM_RECORD',
  'CASE',
  'WORKFLOW_STATE',
  'ENTITLEMENT',
  'POLICY',
  'KNOWLEDGE',
  'COMMUNICATION',
  'BUSINESS_EVENT',
] as const;

export type ContextKind = (typeof CONTEXT_KINDS)[number];

export interface ContextReference {
  readonly kind: ContextKind;
  readonly referenceId: string;
}

export interface ContextAssemblyRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly requesterSubjectId: string;
  readonly requesterAgentId: string | null;
  readonly purpose: string;
  readonly references: readonly ContextReference[];
  readonly requestedAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export interface ContextAuthorizationQuery {
  readonly requestId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly agentId: string | null;
  readonly purpose: string;
  readonly action: 'context.read';
  readonly reference: ContextReference;
  readonly correlationId: string;
}

export interface ContextAuthorizationDecision {
  readonly decisionId: string;
  readonly allowed: boolean;
  readonly reasonKey: string;
}

export interface ContextAuthorizationPort {
  authorize(
    query: ContextAuthorizationQuery,
  ): Promise<ContextAuthorizationDecision>;
}

export interface ContextProviderInput {
  readonly requestId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly agentId: string | null;
  readonly purpose: string;
  readonly referenceId: string;
  readonly correlationId: string;
}

export interface ContextRecord {
  readonly kind: ContextKind;
  readonly referenceId: string;
  readonly tenantId: string;
  readonly sourceReference: string;
  readonly observedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ContextProvider {
  readonly kind: ContextKind;
  load(input: ContextProviderInput): Promise<ContextRecord>;
}

export interface AuthorizedContextItem {
  readonly authorizationDecisionId: string;
  readonly record: ContextRecord;
}

export interface AuthorizedContextBundle {
  readonly requestId: string;
  readonly tenantId: string;
  readonly requesterSubjectId: string;
  readonly requesterAgentId: string | null;
  readonly purpose: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
  readonly items: readonly AuthorizedContextItem[];
  readonly sourceReferences: readonly string[];
  readonly assembledAt: string;
}

export type ContextEngineErrorCode =
  | 'CONTEXT_PROVIDER_DUPLICATE'
  | 'CONTEXT_PROVIDER_MISSING'
  | 'CONTEXT_REQUEST_INVALID'
  | 'CONTEXT_REFERENCE_DUPLICATE'
  | 'CONTEXT_AUTHORIZATION_DECISION_INVALID'
  | 'CONTEXT_ACCESS_DENIED'
  | 'CONTEXT_RECORD_IDENTITY_MISMATCH'
  | 'CONTEXT_SOURCE_REFERENCE_REQUIRED'
  | 'CONTEXT_OBSERVED_AT_INVALID'
  | 'CONTEXT_ASSEMBLED_AT_INVALID';

export class ContextEngineError extends Error {
  readonly code: ContextEngineErrorCode;
  readonly reference: ContextReference | undefined;
  readonly reasonKey: string | undefined;

  constructor(
    code: ContextEngineErrorCode,
    message: string,
    reference?: ContextReference,
    reasonKey?: string,
  ) {
    super(message);
    this.name = 'ContextEngineError';
    this.code = code;
    this.reference = reference;
    this.reasonKey = reasonKey;
  }
}

export interface AuthorizedContextEngineDependencies {
  readonly authorization: ContextAuthorizationPort;
  readonly providers: readonly ContextProvider[];
  readonly now: () => string;
}

export class AuthorizedContextEngine {
  private readonly dependencies: AuthorizedContextEngineDependencies;
  private readonly providers = new Map<ContextKind, ContextProvider>();

  constructor(dependencies: AuthorizedContextEngineDependencies) {
    this.dependencies = dependencies;
    for (const provider of dependencies.providers) {
      if (this.providers.has(provider.kind)) {
        throw new ContextEngineError(
          'CONTEXT_PROVIDER_DUPLICATE',
          'A context kind can have only one registered provider.',
        );
      }
      this.providers.set(provider.kind, provider);
    }
  }

  async assemble(
    request: ContextAssemblyRequest,
  ): Promise<AuthorizedContextBundle> {
    validateRequest(request);

    const plans = request.references.map((reference) => {
      const provider = this.providers.get(reference.kind);
      if (provider === undefined) {
        throw new ContextEngineError(
          'CONTEXT_PROVIDER_MISSING',
          'No provider is registered for the requested context kind.',
          reference,
        );
      }
      return { reference, provider };
    });

    const decisions = await Promise.all(
      plans.map(({ reference }) =>
        this.dependencies.authorization.authorize({
          requestId: request.requestId,
          tenantId: request.tenantId,
          subjectId: request.requesterSubjectId,
          agentId: request.requesterAgentId,
          purpose: request.purpose,
          action: 'context.read',
          reference,
          correlationId: request.correlationId,
        }),
      ),
    );

    decisions.forEach((decision, index) => {
      const reference = plans[index]?.reference;
      if (reference === undefined) {
        throw new ContextEngineError(
          'CONTEXT_AUTHORIZATION_DECISION_INVALID',
          'Authorization did not return a decision for every context reference.',
        );
      }
      if (decision.decisionId.trim() === '' || decision.reasonKey.trim() === '') {
        throw new ContextEngineError(
          'CONTEXT_AUTHORIZATION_DECISION_INVALID',
          'Authorization decisions require stable decision and reason identifiers.',
          reference,
        );
      }
      if (!decision.allowed) {
        throw new ContextEngineError(
          'CONTEXT_ACCESS_DENIED',
          'Context access was denied.',
          reference,
          decision.reasonKey,
        );
      }
    });

    const records = await Promise.all(
      plans.map(({ reference, provider }) =>
        provider.load({
          requestId: request.requestId,
          tenantId: request.tenantId,
          subjectId: request.requesterSubjectId,
          agentId: request.requesterAgentId,
          purpose: request.purpose,
          referenceId: reference.referenceId,
          correlationId: request.correlationId,
        }),
      ),
    );

    const items = records.map((record, index): AuthorizedContextItem => {
      const plan = plans[index];
      const decision = decisions[index];
      if (
        plan === undefined
        || decision === undefined
        || record.tenantId !== request.tenantId
        || record.kind !== plan.reference.kind
        || record.referenceId !== plan.reference.referenceId
      ) {
        throw new ContextEngineError(
          'CONTEXT_RECORD_IDENTITY_MISMATCH',
          'A provider returned context outside the authorized tenant or reference.',
          plan?.reference,
        );
      }
      if (record.sourceReference.trim() === '') {
        throw new ContextEngineError(
          'CONTEXT_SOURCE_REFERENCE_REQUIRED',
          'Context records require source provenance.',
          plan.reference,
        );
      }
      if (!validInstant(record.observedAt)) {
        throw new ContextEngineError(
          'CONTEXT_OBSERVED_AT_INVALID',
          'Context records require a valid observation time.',
          plan.reference,
        );
      }
      return {
        authorizationDecisionId: decision.decisionId,
        record,
      };
    });

    const assembledAt = this.dependencies.now();
    if (!validInstant(assembledAt)) {
      throw new ContextEngineError(
        'CONTEXT_ASSEMBLED_AT_INVALID',
        'The context bundle requires a valid assembly time.',
      );
    }

    return {
      requestId: request.requestId,
      tenantId: request.tenantId,
      requesterSubjectId: request.requesterSubjectId,
      requesterAgentId: request.requesterAgentId,
      purpose: request.purpose,
      correlationId: request.correlationId,
      evidenceRefs: [...request.evidenceRefs],
      items,
      sourceReferences: [
        ...new Set(records.map((record) => record.sourceReference)),
      ],
      assembledAt,
    };
  }
}

function validateRequest(request: ContextAssemblyRequest): void {
  if (
    !nonBlank(request.requestId)
    || !nonBlank(request.tenantId)
    || !nonBlank(request.requesterSubjectId)
    || !nonBlank(request.purpose)
    || !validInstant(request.requestedAt)
    || !nonBlank(request.correlationId)
    || request.evidenceRefs.length === 0
    || request.evidenceRefs.some((reference) => !nonBlank(reference))
    || request.references.length === 0
    || request.references.some((reference) => !nonBlank(reference.referenceId))
  ) {
    throw new ContextEngineError(
      'CONTEXT_REQUEST_INVALID',
      'Context requests require governed identity, purpose, time, correlation, evidence, and references.',
    );
  }

  const references = new Set<string>();
  for (const reference of request.references) {
    const key = reference.kind + ':' + reference.referenceId;
    if (references.has(key)) {
      throw new ContextEngineError(
        'CONTEXT_REFERENCE_DUPLICATE',
        'A context reference can be requested only once.',
        reference,
      );
    }
    references.add(key);
  }
}

function nonBlank(value: string): boolean {
  return value.trim() !== '';
}

function validInstant(value: string): boolean {
  return nonBlank(value) && Number.isFinite(Date.parse(value));
}
