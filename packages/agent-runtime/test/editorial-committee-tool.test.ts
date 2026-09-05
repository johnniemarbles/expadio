import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiGateway, AiInvocationIntent, AiProposal } from '@expadio/ai-gateway';
import {
  createEditorialCommitteeTool,
  EDITORIAL_COMMITTEE_TOOL_KEY,
  type EditorialArtifactStore,
  type EditorialBriefResolver,
} from '../src/committees/editorial-committee-tool.ts';
import type { EditorialDebateResult } from '../src/committees/editorial-committee.ts';
import type { AgentToolAdapterInput } from '../src/index.ts';

function proposalFor(intent: AiInvocationIntent, text: string): AiProposal {
  return {
    invocationId: intent.invocationId,
    tenantId: intent.tenantId,
    status: 'OBSERVATION',
    outputReference: `provider-output://${intent.invocationId}`,
    outputContent: { mediaType: 'text/plain', value: text },
    provenance: {
      connectorKey: 'fake-connector',
      providerKey: 'fake-provider',
      modelKey: 'fake-model',
      promptConfigurationKey: intent.promptConfiguration.key,
      promptConfigurationVersion: intent.promptConfiguration.version,
      sourceReferences: [intent.inputReference],
      processedAt: intent.requestedAt,
    },
  };
}

const gateway: AiGateway = {
  async invoke(intent: AiInvocationIntent): Promise<AiProposal> {
    if (intent.purpose === 'editorial.trend_hunter') {
      return proposalFor(intent, JSON.stringify({ angle: 'Angle', hook: 'Hook' }));
    }
    if (intent.purpose === 'editorial.copywriter') {
      return proposalFor(intent, 'Sealed draft');
    }
    return proposalFor(intent, JSON.stringify({ score: 9.5, critique: 'Good.', compliancePass: true }));
  },
};

const briefResolver: EditorialBriefResolver = {
  async resolveBrief() {
    return {
      verticalTheme: 'Salon Expansion',
      brandVoiceGuideline: 'Direct',
      compliancePack: 'FTC Franchise Rules',
    };
  },
};

const toolInput: AgentToolAdapterInput = {
  executionId: 'exec-1',
  tenantId: 'tenant-1',
  subjectId: 'sub-1',
  agentId: 'agent-editorial',
  purpose: 'Run editorial debate',
  inputReference: 'ref:task:11111111-1111-1111-1111-111111111111:input',
  contextBundleReference: 'ref:task:11111111-1111-1111-1111-111111111111:context',
  idempotencyKey: 'idem-1',
  correlationId: 'corr-1',
};

test('editorial committee tool has OBSERVE effect since it never publishes anything itself', () => {
  const artifactStore: EditorialArtifactStore = { async save() {} };
  const tool = createEditorialCommitteeTool({ aiGateway: gateway, briefResolver, artifactStore });
  assert.equal(tool.toolKey, EDITORIAL_COMMITTEE_TOOL_KEY);
  assert.equal(tool.effect, 'OBSERVE');
});

test('editorial committee tool persists the debate result and returns a valid observation', async () => {
  const saved: Array<{ tenantId: string; key: string; value: EditorialDebateResult }> = [];
  const artifactStore: EditorialArtifactStore = {
    async save(input) {
      saved.push(input);
    },
  };
  const tool = createEditorialCommitteeTool({ aiGateway: gateway, briefResolver, artifactStore });

  const observation = await tool.invoke(toolInput);

  assert.equal(observation.executionId, toolInput.executionId);
  assert.equal(observation.tenantId, toolInput.tenantId);
  assert.equal(observation.toolKey, EDITORIAL_COMMITTEE_TOOL_KEY);
  assert.equal(observation.kind, 'OBSERVATION');
  assert.equal(observation.outputReference, `memory://editorial-debate:${toolInput.executionId}`);
  assert.deepEqual(observation.sourceReferences, [toolInput.contextBundleReference]);
  assert.ok(Number.isFinite(Date.parse(observation.producedAt)));

  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.tenantId, toolInput.tenantId);
  assert.equal(saved[0]?.key, `editorial-debate:${toolInput.executionId}`);
  assert.equal(saved[0]?.value.fullCopy, 'Sealed draft');
  assert.equal(saved[0]?.value.consensusScore, 9.5);
});

test('editorial committee tool propagates brief resolution failures without persisting anything', async () => {
  const saved: unknown[] = [];
  const artifactStore: EditorialArtifactStore = {
    async save(input) {
      saved.push(input);
    },
  };
  const failingResolver: EditorialBriefResolver = {
    async resolveBrief() {
      throw new Error('EDITORIAL_BRIEF_TASK_NOT_FOUND');
    },
  };
  const tool = createEditorialCommitteeTool({ aiGateway: gateway, briefResolver: failingResolver, artifactStore });

  await assert.rejects(() => tool.invoke(toolInput), /EDITORIAL_BRIEF_TASK_NOT_FOUND/);
  assert.equal(saved.length, 0);
});
