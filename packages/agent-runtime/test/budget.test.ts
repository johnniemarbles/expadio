import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentBudgetError,
  BudgetedAgentRuntime,
  type AgentToolIntent,
  type AuthorizedAgentToolReceipt,
  type BudgetedAgentToolRequest,
} from '../src/index.ts';

const intent: AgentToolIntent = {
  executionId: 'execution-1',
  tenantId: 'tenant-1',
  requesterSubjectId: 'subject-1',
  agentId: 'agent-1',
  toolKey: 'account-briefing',
  effect: 'PROPOSE',
  purpose: 'Draft an account briefing.',
  inputReference: 'request://briefing/1',
  contextBundleReference: 'context://bundle/1',
  idempotencyKey: 'briefing:1',
  requestedAt: '2026-08-25T19:00:00.000Z',
  correlationId: 'correlation-1',
  evidenceRefs: ['evidence://workflow/42'],
};

const request: BudgetedAgentToolRequest = {
  runId: 'run-1',
  budgetPolicyReference: 'policy://agent-budget/v3',
  estimatedCostMinorUnits: 7,
  intent,
};

function toolReceipt(): AuthorizedAgentToolReceipt {
  return {
    executionId: intent.executionId,
    tenantId: intent.tenantId,
    authorizationDecisionId: 'authorization-1',
    correlationId: intent.correlationId,
    evidenceRefs: intent.evidenceRefs,
    observation: {
      executionId: intent.executionId,
      tenantId: intent.tenantId,
      toolKey: intent.toolKey,
      kind: 'PROPOSAL',
      outputReference: 'proposal://briefing/1',
      sourceReferences: [
        intent.inputReference,
        intent.contextBundleReference,
      ],
      producedAt: '2026-08-25T19:00:01.000Z',
    },
  };
}

test('reserves budget before invoking an authorized tool', async () => {
  const events: string[] = [];
  const runtime = new BudgetedAgentRuntime({
    ledger: {
      async reserve(reservation) {
        events.push('reserve:' + reservation.executionId);
        assert.equal(
          reservation.budgetPolicyReference,
          'policy://agent-budget/v3',
        );
        return {
          allowed: true,
          reservationId: 'reservation-1',
          reasonKey: 'RESERVED',
          stepNumber: 2,
          reservedCostMinorUnits: 7,
          remainingCostMinorUnits: 43,
        };
      },
    },
    tools: {
      async invoke() {
        events.push('invoke:execution-1');
        return toolReceipt();
      },
    },
  });

  const receipt = await runtime.invoke(request);

  assert.deepEqual(events, [
    'reserve:execution-1',
    'invoke:execution-1',
  ]);
  assert.equal(receipt.budgetReservationId, 'reservation-1');
  assert.equal(receipt.remainingCostMinorUnits, 43);
});

test('budget denial prevents provider invocation', async () => {
  let invoked = false;
  const runtime = new BudgetedAgentRuntime({
    ledger: {
      async reserve() {
        return {
          allowed: false,
          reservationId: 'reservation-2',
          reasonKey: 'MONTHLY_COST_LIMIT',
          stepNumber: 3,
          reservedCostMinorUnits: 0,
          remainingCostMinorUnits: 0,
        };
      },
    },
    tools: {
      async invoke() {
        invoked = true;
        return toolReceipt();
      },
    },
  });

  await assert.rejects(
    () => runtime.invoke(request),
    (error: unknown) =>
      error instanceof AgentBudgetError
      && error.code === 'AGENT_BUDGET_EXCEEDED'
      && error.reasonKey === 'MONTHLY_COST_LIMIT',
  );
  assert.equal(invoked, false);
});

test('invalid cost estimates fail before the ledger is called', async () => {
  let ledgerCalls = 0;
  const runtime = new BudgetedAgentRuntime({
    ledger: {
      async reserve() {
        ledgerCalls += 1;
        throw new Error('unreachable');
      },
    },
    tools: {
      async invoke() {
        throw new Error('unreachable');
      },
    },
  });

  await assert.rejects(
    () =>
      runtime.invoke({
        ...request,
        estimatedCostMinorUnits: -1,
      }),
    (error: unknown) =>
      error instanceof AgentBudgetError
      && error.code === 'AGENT_BUDGET_REQUEST_INVALID',
  );
  assert.equal(ledgerCalls, 0);
});

test('fails closed when the ledger reserves a different amount', async () => {
  let invoked = false;
  const runtime = new BudgetedAgentRuntime({
    ledger: {
      async reserve() {
        return {
          allowed: true,
          reservationId: 'reservation-3',
          reasonKey: 'RESERVED',
          stepNumber: 1,
          reservedCostMinorUnits: 6,
          remainingCostMinorUnits: 44,
        };
      },
    },
    tools: {
      async invoke() {
        invoked = true;
        return toolReceipt();
      },
    },
  });

  await assert.rejects(
    () => runtime.invoke(request),
    (error: unknown) =>
      error instanceof AgentBudgetError
      && error.code === 'AGENT_BUDGET_DECISION_INVALID',
  );
  assert.equal(invoked, false);
});
