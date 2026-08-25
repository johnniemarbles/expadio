import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRuntimeError,
  AuthorizedAgentRuntime,
  type AgentToolAdapter,
  type AgentToolIntent,
} from '../src/index.ts';

const intent: AgentToolIntent = {
  executionId: 'execution-1',
  tenantId: 'tenant-1',
  requesterSubjectId: 'subject-1',
  agentId: 'agent-1',
  toolKey: 'account-briefing',
  effect: 'PROPOSE',
  purpose: 'Draft an account briefing for human review.',
  inputReference: 'request://briefing/1',
  contextBundleReference: 'context://bundle/1',
  idempotencyKey: 'briefing:1',
  requestedAt: '2026-08-25T17:00:00.000Z',
  correlationId: 'correlation-1',
  evidenceRefs: ['evidence://workflow/42'],
};

function proposalTool(
  invocations: string[],
  overrides: Record<string, unknown> = {},
): AgentToolAdapter {
  return {
    toolKey: 'account-briefing',
    effect: 'PROPOSE',
    async invoke(input) {
      invocations.push(input.executionId);
      return {
        executionId: input.executionId,
        tenantId: input.tenantId,
        toolKey: 'account-briefing',
        kind: 'PROPOSAL',
        outputReference: 'proposal://briefing/1',
        sourceReferences: [
          input.inputReference,
          input.contextBundleReference,
        ],
        producedAt: '2026-08-25T17:00:01.000Z',
        ...overrides,
      };
    },
  };
}

test('authorizes before invoking a provider-neutral proposal tool', async () => {
  const events: string[] = [];
  const runtime = new AuthorizedAgentRuntime({
    authorization: {
      async authorize(query) {
        events.push('authorize:' + query.toolKey);
        assert.equal(query.action, 'agent.tool.invoke');
        assert.equal(query.contextBundleReference, 'context://bundle/1');
        return {
          allowed: true,
          decisionId: 'decision-1',
          reasonKey: 'GRANTED',
        };
      },
    },
    tools: [
      proposalTool(events),
    ],
  });

  const receipt = await runtime.invoke(intent);

  assert.deepEqual(events, [
    'authorize:account-briefing',
    'execution-1',
  ]);
  assert.equal(receipt.authorizationDecisionId, 'decision-1');
  assert.equal(receipt.observation.kind, 'PROPOSAL');
  assert.deepEqual(receipt.observation.sourceReferences, [
    'request://briefing/1',
    'context://bundle/1',
  ]);
});

test('denial prevents tool invocation', async () => {
  const invocations: string[] = [];
  const runtime = new AuthorizedAgentRuntime({
    authorization: {
      async authorize() {
        return {
          allowed: false,
          decisionId: 'decision-2',
          reasonKey: 'ENTITLEMENT_REQUIRED',
        };
      },
    },
    tools: [proposalTool(invocations)],
  });

  await assert.rejects(
    () => runtime.invoke(intent),
    (error: unknown) =>
      error instanceof AgentRuntimeError
      && error.code === 'AGENT_TOOL_ACCESS_DENIED'
      && error.reasonKey === 'ENTITLEMENT_REQUIRED',
  );
  assert.deepEqual(invocations, []);
});

test('rejects tool output from another tenant', async () => {
  const runtime = new AuthorizedAgentRuntime({
    authorization: {
      async authorize() {
        return {
          allowed: true,
          decisionId: 'decision-3',
          reasonKey: 'GRANTED',
        };
      },
    },
    tools: [
      proposalTool([], { tenantId: 'tenant-2' }),
    ],
  });

  await assert.rejects(
    () => runtime.invoke(intent),
    (error: unknown) =>
      error instanceof AgentRuntimeError
      && error.code === 'AGENT_TOOL_OUTPUT_IDENTITY_MISMATCH',
  );
});

test('prevents a proposal tool from returning mutation-like observations', async () => {
  const runtime = new AuthorizedAgentRuntime({
    authorization: {
      async authorize() {
        return {
          allowed: true,
          decisionId: 'decision-4',
          reasonKey: 'GRANTED',
        };
      },
    },
    tools: [
      proposalTool([], { kind: 'OBSERVATION' }),
    ],
  });

  await assert.rejects(
    () => runtime.invoke(intent),
    (error: unknown) =>
      error instanceof AgentRuntimeError
      && error.code === 'AGENT_TOOL_OUTPUT_KIND_MISMATCH',
  );
});

test('rejects duplicate tool registration', () => {
  assert.throws(
    () =>
      new AuthorizedAgentRuntime({
        authorization: {
          async authorize() {
            return {
              allowed: true,
              decisionId: 'decision-5',
              reasonKey: 'GRANTED',
            };
          },
        },
        tools: [
          proposalTool([]),
          proposalTool([]),
        ],
      }),
    (error: unknown) =>
      error instanceof AgentRuntimeError
      && error.code === 'AGENT_TOOL_DUPLICATE',
  );
});
