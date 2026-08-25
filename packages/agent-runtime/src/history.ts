export interface AgentRunRecord {
  readonly runId: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly purpose: string;
  readonly contextBundleReference: string;
  readonly budgetPolicyReference: string;
  readonly idempotencyKey: string;
  readonly requestedBySubjectId: string;
  readonly requestedAt: string;
  readonly createdAt: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export type AgentRunEventType =
  | 'STARTED'
  | 'CONTEXT_AUTHORIZED'
  | 'TOOL_AUTHORIZED'
  | 'BUDGET_RESERVED'
  | 'PROPOSAL_CREATED'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export interface AgentRunEventRecord {
  readonly eventId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly sequence: number;
  readonly eventType: AgentRunEventType;
  readonly eventReference: string;
  readonly occurredAt: string;
  readonly actorSubjectId: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
  readonly costMinorUnits: number | null;
}

export interface AgentRunHistory {
  readonly run: AgentRunRecord;
  readonly events: readonly AgentRunEventRecord[];
}

export interface RegisterAgentRunResult {
  readonly created: boolean;
  readonly run: AgentRunRecord;
}

export interface AppendAgentRunEventResult {
  readonly appended: boolean;
  readonly event: AgentRunEventRecord;
}

export interface AgentRunRepository {
  register(run: AgentRunRecord): Promise<RegisterAgentRunResult>;
  append(
    event: AgentRunEventRecord,
  ): Promise<AppendAgentRunEventResult>;
  load(
    tenantId: string,
    runId: string,
  ): Promise<AgentRunHistory | undefined>;
}

export type AgentRunHistoryErrorCode =
  | 'AGENT_RUN_INVALID'
  | 'AGENT_RUN_EVENT_INVALID'
  | 'AGENT_RUN_EVENT_IDENTITY_MISMATCH'
  | 'AGENT_RUN_EVENT_SEQUENCE_INVALID'
  | 'AGENT_RUN_STARTED_EVENT_REQUIRED'
  | 'AGENT_RUN_EVENT_AFTER_TERMINAL';

export class AgentRunHistoryError extends Error {
  readonly code: AgentRunHistoryErrorCode;

  constructor(code: AgentRunHistoryErrorCode, message: string) {
    super(message);
    this.name = 'AgentRunHistoryError';
    this.code = code;
  }
}

export function validateAgentRunHistory(
  history: AgentRunHistory,
): AgentRunHistory {
  validateRun(history.run);

  let terminal = false;
  history.events.forEach((event, index) => {
    validateEvent(event);
    if (
      event.runId !== history.run.runId
      || event.tenantId !== history.run.tenantId
      || event.correlationId !== history.run.correlationId
    ) {
      throw new AgentRunHistoryError(
        'AGENT_RUN_EVENT_IDENTITY_MISMATCH',
        'Every event must match the run, tenant, and correlation identity.',
      );
    }
    if (event.sequence !== index + 1) {
      throw new AgentRunHistoryError(
        'AGENT_RUN_EVENT_SEQUENCE_INVALID',
        'Agent run events must form a contiguous sequence starting at one.',
      );
    }
    if (index === 0 && event.eventType !== 'STARTED') {
      throw new AgentRunHistoryError(
        'AGENT_RUN_STARTED_EVENT_REQUIRED',
        'The first agent run event must be STARTED.',
      );
    }
    if (terminal) {
      throw new AgentRunHistoryError(
        'AGENT_RUN_EVENT_AFTER_TERMINAL',
        'Agent run history cannot continue after a terminal event.',
      );
    }
    terminal = isTerminal(event.eventType);
  });

  return {
    run: history.run,
    events: [...history.events],
  };
}

function validateRun(run: AgentRunRecord): void {
  if (
    !nonBlank(run.runId)
    || !nonBlank(run.tenantId)
    || !nonBlank(run.agentId)
    || !nonBlank(run.purpose)
    || !nonBlank(run.contextBundleReference)
    || !nonBlank(run.budgetPolicyReference)
    || !nonBlank(run.idempotencyKey)
    || !nonBlank(run.requestedBySubjectId)
    || !validInstant(run.requestedAt)
    || !validInstant(run.createdAt)
    || !nonBlank(run.reason)
    || !nonBlank(run.correlationId)
    || !validEvidence(run.evidenceRefs)
  ) {
    throw new AgentRunHistoryError(
      'AGENT_RUN_INVALID',
      'Agent run records require governed identity, references, time, reason, correlation, and evidence.',
    );
  }
}

function validateEvent(event: AgentRunEventRecord): void {
  if (
    !nonBlank(event.eventId)
    || !nonBlank(event.runId)
    || !nonBlank(event.tenantId)
    || !Number.isInteger(event.sequence)
    || event.sequence <= 0
    || !nonBlank(event.eventReference)
    || !validInstant(event.occurredAt)
    || !nonBlank(event.actorSubjectId)
    || !nonBlank(event.reason)
    || !nonBlank(event.correlationId)
    || !validEvidence(event.evidenceRefs)
    || (
      event.costMinorUnits !== null
      && (
        !Number.isInteger(event.costMinorUnits)
        || event.costMinorUnits < 0
      )
    )
  ) {
    throw new AgentRunHistoryError(
      'AGENT_RUN_EVENT_INVALID',
      'Agent run events require identity, sequence, reference, actor, time, reason, correlation, evidence, and valid cost.',
    );
  }
}

function isTerminal(eventType: AgentRunEventType): boolean {
  return eventType === 'REJECTED'
    || eventType === 'SUCCEEDED'
    || eventType === 'FAILED'
    || eventType === 'CANCELLED';
}

function validEvidence(references: readonly string[]): boolean {
  return references.length > 0
    && references.every((reference) => nonBlank(reference));
}

function nonBlank(value: string): boolean {
  return value.trim() !== '';
}

function validInstant(value: string): boolean {
  return nonBlank(value) && Number.isFinite(Date.parse(value));
}
