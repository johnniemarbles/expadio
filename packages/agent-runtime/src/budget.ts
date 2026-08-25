import type {
  AgentToolIntent,
  AuthorizedAgentToolReceipt,
} from './index.ts';

export interface AgentBudgetReservationRequest {
  readonly runId: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly idempotencyKey: string;
  readonly budgetPolicyReference: string;
  readonly estimatedCostMinorUnits: number;
  readonly requestedAt: string;
  readonly correlationId: string;
}

export interface AgentBudgetReservationDecision {
  readonly reservationId: string;
  readonly allowed: boolean;
  readonly reasonKey: string;
  readonly stepNumber: number;
  readonly reservedCostMinorUnits: number;
  readonly remainingCostMinorUnits: number;
}

export interface AgentBudgetLedger {
  reserve(
    request: AgentBudgetReservationRequest,
  ): Promise<AgentBudgetReservationDecision>;
}

export interface AgentToolInvoker {
  invoke(intent: AgentToolIntent): Promise<AuthorizedAgentToolReceipt>;
}

export interface BudgetedAgentToolRequest {
  readonly runId: string;
  readonly budgetPolicyReference: string;
  readonly estimatedCostMinorUnits: number;
  readonly intent: AgentToolIntent;
}

export interface BudgetedAgentToolReceipt {
  readonly runId: string;
  readonly budgetPolicyReference: string;
  readonly budgetReservationId: string;
  readonly stepNumber: number;
  readonly reservedCostMinorUnits: number;
  readonly remainingCostMinorUnits: number;
  readonly tool: AuthorizedAgentToolReceipt;
}

export type AgentBudgetErrorCode =
  | 'AGENT_BUDGET_REQUEST_INVALID'
  | 'AGENT_BUDGET_DECISION_INVALID'
  | 'AGENT_BUDGET_EXCEEDED';

export class AgentBudgetError extends Error {
  readonly code: AgentBudgetErrorCode;
  readonly reasonKey: string | undefined;

  constructor(
    code: AgentBudgetErrorCode,
    message: string,
    reasonKey?: string,
  ) {
    super(message);
    this.name = 'AgentBudgetError';
    this.code = code;
    this.reasonKey = reasonKey;
  }
}

export interface BudgetedAgentRuntimeDependencies {
  readonly ledger: AgentBudgetLedger;
  readonly tools: AgentToolInvoker;
}

export class BudgetedAgentRuntime {
  private readonly ledger: AgentBudgetLedger;
  private readonly tools: AgentToolInvoker;

  constructor(dependencies: BudgetedAgentRuntimeDependencies) {
    this.ledger = dependencies.ledger;
    this.tools = dependencies.tools;
  }

  async invoke(
    request: BudgetedAgentToolRequest,
  ): Promise<BudgetedAgentToolReceipt> {
    validateRequest(request);

    const decision = await this.ledger.reserve({
      runId: request.runId,
      tenantId: request.intent.tenantId,
      executionId: request.intent.executionId,
      idempotencyKey: request.intent.idempotencyKey,
      budgetPolicyReference: request.budgetPolicyReference,
      estimatedCostMinorUnits: request.estimatedCostMinorUnits,
      requestedAt: request.intent.requestedAt,
      correlationId: request.intent.correlationId,
    });

    validateDecision(request, decision);
    if (!decision.allowed) {
      throw new AgentBudgetError(
        'AGENT_BUDGET_EXCEEDED',
        'The agent run budget did not authorize this tool step.',
        decision.reasonKey,
      );
    }

    const tool = await this.tools.invoke(request.intent);
    return {
      runId: request.runId,
      budgetPolicyReference: request.budgetPolicyReference,
      budgetReservationId: decision.reservationId,
      stepNumber: decision.stepNumber,
      reservedCostMinorUnits: decision.reservedCostMinorUnits,
      remainingCostMinorUnits: decision.remainingCostMinorUnits,
      tool,
    };
  }
}

function validateRequest(request: BudgetedAgentToolRequest): void {
  if (
    !nonBlank(request.runId)
    || !nonBlank(request.budgetPolicyReference)
    || !Number.isInteger(request.estimatedCostMinorUnits)
    || request.estimatedCostMinorUnits < 0
    || request.intent.tenantId.trim() === ''
    || request.intent.executionId.trim() === ''
    || request.intent.idempotencyKey.trim() === ''
    || request.intent.correlationId.trim() === ''
    || !validInstant(request.intent.requestedAt)
  ) {
    throw new AgentBudgetError(
      'AGENT_BUDGET_REQUEST_INVALID',
      'Budget reservations require governed run identity, policy, cost, time, idempotency, and correlation.',
    );
  }
}

function validateDecision(
  request: BudgetedAgentToolRequest,
  decision: AgentBudgetReservationDecision,
): void {
  if (
    !nonBlank(decision.reservationId)
    || !nonBlank(decision.reasonKey)
    || !Number.isInteger(decision.stepNumber)
    || decision.stepNumber <= 0
    || !Number.isInteger(decision.reservedCostMinorUnits)
    || decision.reservedCostMinorUnits < 0
    || !Number.isInteger(decision.remainingCostMinorUnits)
    || decision.remainingCostMinorUnits < 0
    || (
      decision.allowed
      && decision.reservedCostMinorUnits
        !== request.estimatedCostMinorUnits
    )
  ) {
    throw new AgentBudgetError(
      'AGENT_BUDGET_DECISION_INVALID',
      'The budget ledger returned an invalid reservation decision.',
    );
  }
}

function nonBlank(value: string): boolean {
  return value.trim() !== '';
}

function validInstant(value: string): boolean {
  return nonBlank(value) && Number.isFinite(Date.parse(value));
}
