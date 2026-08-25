export type AgentToolEffect = 'OBSERVE' | 'PROPOSE';

export interface AgentToolIntent {
  readonly executionId: string;
  readonly tenantId: string;
  readonly requesterSubjectId: string;
  readonly agentId: string;
  readonly toolKey: string;
  readonly effect: AgentToolEffect;
  readonly purpose: string;
  readonly inputReference: string;
  readonly contextBundleReference: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export interface AgentToolAuthorizationQuery {
  readonly executionId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly agentId: string;
  readonly toolKey: string;
  readonly effect: AgentToolEffect;
  readonly purpose: string;
  readonly contextBundleReference: string;
  readonly action: 'agent.tool.invoke';
  readonly correlationId: string;
}

export interface AgentToolAuthorizationDecision {
  readonly decisionId: string;
  readonly allowed: boolean;
  readonly reasonKey: string;
}

export interface AgentToolAuthorizationPort {
  authorize(
    query: AgentToolAuthorizationQuery,
  ): Promise<AgentToolAuthorizationDecision>;
}

export interface AgentToolAdapterInput {
  readonly executionId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly agentId: string;
  readonly purpose: string;
  readonly inputReference: string;
  readonly contextBundleReference: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface AgentToolObservation {
  readonly executionId: string;
  readonly tenantId: string;
  readonly toolKey: string;
  readonly kind: 'OBSERVATION' | 'PROPOSAL';
  readonly outputReference: string;
  readonly sourceReferences: readonly string[];
  readonly producedAt: string;
}

export interface AgentToolAdapter {
  readonly toolKey: string;
  readonly effect: AgentToolEffect;
  invoke(input: AgentToolAdapterInput): Promise<AgentToolObservation>;
}

export interface AuthorizedAgentToolReceipt {
  readonly executionId: string;
  readonly tenantId: string;
  readonly authorizationDecisionId: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
  readonly observation: AgentToolObservation;
}

export type AgentRuntimeErrorCode =
  | 'AGENT_TOOL_DUPLICATE'
  | 'AGENT_TOOL_MISSING'
  | 'AGENT_TOOL_EFFECT_MISMATCH'
  | 'AGENT_TOOL_INTENT_INVALID'
  | 'AGENT_TOOL_AUTHORIZATION_DECISION_INVALID'
  | 'AGENT_TOOL_ACCESS_DENIED'
  | 'AGENT_TOOL_OUTPUT_IDENTITY_MISMATCH'
  | 'AGENT_TOOL_OUTPUT_KIND_MISMATCH'
  | 'AGENT_TOOL_OUTPUT_REFERENCE_REQUIRED'
  | 'AGENT_TOOL_SOURCE_REFERENCE_REQUIRED'
  | 'AGENT_TOOL_PRODUCED_AT_INVALID';

export class AgentRuntimeError extends Error {
  readonly code: AgentRuntimeErrorCode;
  readonly reasonKey: string | undefined;

  constructor(
    code: AgentRuntimeErrorCode,
    message: string,
    reasonKey?: string,
  ) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
    this.reasonKey = reasonKey;
  }
}

export interface AuthorizedAgentRuntimeDependencies {
  readonly authorization: AgentToolAuthorizationPort;
  readonly tools: readonly AgentToolAdapter[];
}

export class AuthorizedAgentRuntime {
  private readonly authorization: AgentToolAuthorizationPort;
  private readonly tools = new Map<string, AgentToolAdapter>();

  constructor(dependencies: AuthorizedAgentRuntimeDependencies) {
    this.authorization = dependencies.authorization;
    for (const tool of dependencies.tools) {
      if (!nonBlank(tool.toolKey)) {
        throw new AgentRuntimeError(
          'AGENT_TOOL_INTENT_INVALID',
          'Registered tools require a stable key.',
        );
      }
      if (this.tools.has(tool.toolKey)) {
        throw new AgentRuntimeError(
          'AGENT_TOOL_DUPLICATE',
          'A tool key can have only one registered adapter.',
        );
      }
      this.tools.set(tool.toolKey, tool);
    }
  }

  async invoke(
    intent: AgentToolIntent,
  ): Promise<AuthorizedAgentToolReceipt> {
    validateIntent(intent);

    const tool = this.tools.get(intent.toolKey);
    if (tool === undefined) {
      throw new AgentRuntimeError(
        'AGENT_TOOL_MISSING',
        'No adapter is registered for the requested tool.',
      );
    }
    if (tool.effect !== intent.effect) {
      throw new AgentRuntimeError(
        'AGENT_TOOL_EFFECT_MISMATCH',
        'The requested effect does not match the registered tool contract.',
      );
    }

    const decision = await this.authorization.authorize({
      executionId: intent.executionId,
      tenantId: intent.tenantId,
      subjectId: intent.requesterSubjectId,
      agentId: intent.agentId,
      toolKey: intent.toolKey,
      effect: intent.effect,
      purpose: intent.purpose,
      contextBundleReference: intent.contextBundleReference,
      action: 'agent.tool.invoke',
      correlationId: intent.correlationId,
    });

    if (!nonBlank(decision.decisionId) || !nonBlank(decision.reasonKey)) {
      throw new AgentRuntimeError(
        'AGENT_TOOL_AUTHORIZATION_DECISION_INVALID',
        'Tool authorization requires stable decision and reason identifiers.',
      );
    }
    if (!decision.allowed) {
      throw new AgentRuntimeError(
        'AGENT_TOOL_ACCESS_DENIED',
        'Agent tool access was denied.',
        decision.reasonKey,
      );
    }

    const observation = await tool.invoke({
      executionId: intent.executionId,
      tenantId: intent.tenantId,
      subjectId: intent.requesterSubjectId,
      agentId: intent.agentId,
      purpose: intent.purpose,
      inputReference: intent.inputReference,
      contextBundleReference: intent.contextBundleReference,
      idempotencyKey: intent.idempotencyKey,
      correlationId: intent.correlationId,
    });

    if (
      observation.executionId !== intent.executionId
      || observation.tenantId !== intent.tenantId
      || observation.toolKey !== intent.toolKey
    ) {
      throw new AgentRuntimeError(
        'AGENT_TOOL_OUTPUT_IDENTITY_MISMATCH',
        'A tool returned output outside the authorized execution or tenant.',
      );
    }

    const expectedKind =
      intent.effect === 'OBSERVE' ? 'OBSERVATION' : 'PROPOSAL';
    if (observation.kind !== expectedKind) {
      throw new AgentRuntimeError(
        'AGENT_TOOL_OUTPUT_KIND_MISMATCH',
        'A tool output must remain an observation or proposal matching its declared effect.',
      );
    }
    if (!nonBlank(observation.outputReference)) {
      throw new AgentRuntimeError(
        'AGENT_TOOL_OUTPUT_REFERENCE_REQUIRED',
        'Tool output must be stored behind a governed reference.',
      );
    }
    if (
      observation.sourceReferences.length === 0
      || observation.sourceReferences.some((reference) => !nonBlank(reference))
    ) {
      throw new AgentRuntimeError(
        'AGENT_TOOL_SOURCE_REFERENCE_REQUIRED',
        'Tool output requires source provenance.',
      );
    }
    if (!validInstant(observation.producedAt)) {
      throw new AgentRuntimeError(
        'AGENT_TOOL_PRODUCED_AT_INVALID',
        'Tool output requires a valid production time.',
      );
    }

    return {
      executionId: intent.executionId,
      tenantId: intent.tenantId,
      authorizationDecisionId: decision.decisionId,
      correlationId: intent.correlationId,
      evidenceRefs: [...intent.evidenceRefs],
      observation,
    };
  }
}

function validateIntent(intent: AgentToolIntent): void {
  if (
    !nonBlank(intent.executionId)
    || !nonBlank(intent.tenantId)
    || !nonBlank(intent.requesterSubjectId)
    || !nonBlank(intent.agentId)
    || !nonBlank(intent.toolKey)
    || !nonBlank(intent.purpose)
    || !nonBlank(intent.inputReference)
    || !nonBlank(intent.contextBundleReference)
    || !nonBlank(intent.idempotencyKey)
    || !validInstant(intent.requestedAt)
    || !nonBlank(intent.correlationId)
    || intent.evidenceRefs.length === 0
    || intent.evidenceRefs.some((reference) => !nonBlank(reference))
  ) {
    throw new AgentRuntimeError(
      'AGENT_TOOL_INTENT_INVALID',
      'Tool intents require governed identity, purpose, references, time, idempotency, correlation, and evidence.',
    );
  }
}

function nonBlank(value: string): boolean {
  return value.trim() !== '';
}

function validInstant(value: string): boolean {
  return nonBlank(value) && Number.isFinite(Date.parse(value));
}

export * from './approval.ts';
export * from './budget.ts';
