import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLeadOsintTool,
  LEAD_OSINT_TOOL_KEY,
  type LeadArtifactStore,
  type LeadDossier,
  type LeadOsintPort,
  type LeadTargetResolver,
} from '../src/committees/lead-osint-tool.ts';
import type { AgentToolAdapterInput } from '../src/index.ts';

const toolInput: AgentToolAdapterInput = {
  executionId: 'exec-1',
  tenantId: 'tenant-1',
  subjectId: 'sub-1',
  agentId: 'agent-osint',
  purpose: 'Research lead',
  inputReference: 'ref:task:22222222-2222-2222-2222-222222222222:input',
  contextBundleReference: 'ref:task:22222222-2222-2222-2222-222222222222:context',
  idempotencyKey: 'idem-1',
  correlationId: 'corr-1',
};

const dossier: LeadDossier = {
  companySize: '50-200',
  fundingStage: 'Series A',
  techStack: ['Shopify', 'HubSpot'],
  recentNews: ['Opened a second location'],
};

test('lead osint tool has OBSERVE effect since it only reads external data', () => {
  const targetResolver: LeadTargetResolver = { async resolveTarget() { return 'acme.example.com'; } };
  const osintPort: LeadOsintPort = { async research() { return dossier; } };
  const artifactStore: LeadArtifactStore = { async save() {} };

  const tool = createLeadOsintTool({ osintPort, targetResolver, artifactStore });

  assert.equal(tool.toolKey, LEAD_OSINT_TOOL_KEY);
  assert.equal(tool.effect, 'OBSERVE');
});

test('lead osint tool resolves the target, researches it, and persists the dossier', async () => {
  const seenTargets: string[] = [];
  const targetResolver: LeadTargetResolver = {
    async resolveTarget(inputReference, tenantId) {
      assert.equal(inputReference, toolInput.inputReference);
      assert.equal(tenantId, toolInput.tenantId);
      return 'acme.example.com';
    },
  };
  const osintPort: LeadOsintPort = {
    async research(target) {
      seenTargets.push(target);
      return dossier;
    },
  };
  const saved: Array<{ tenantId: string; key: string; value: LeadDossier }> = [];
  const artifactStore: LeadArtifactStore = {
    async save(input) {
      saved.push(input);
    },
  };

  const tool = createLeadOsintTool({ osintPort, targetResolver, artifactStore });
  const observation = await tool.invoke(toolInput);

  assert.deepEqual(seenTargets, ['acme.example.com']);
  assert.equal(observation.kind, 'OBSERVATION');
  assert.equal(observation.outputReference, `memory://lead-dossier:${toolInput.executionId}`);
  assert.deepEqual(observation.sourceReferences, [toolInput.contextBundleReference]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.key, `lead-dossier:${toolInput.executionId}`);
  assert.deepEqual(saved[0]?.value, dossier);
});

test('lead osint tool propagates target resolution failures without researching or persisting anything', async () => {
  const targetResolver: LeadTargetResolver = {
    async resolveTarget() {
      throw new Error('REVENUE_TASK_NOT_FOUND');
    },
  };
  let researchCalled = false;
  const osintPort: LeadOsintPort = {
    async research() {
      researchCalled = true;
      return dossier;
    },
  };
  const artifactStore: LeadArtifactStore = { async save() {} };

  const tool = createLeadOsintTool({ osintPort, targetResolver, artifactStore });

  await assert.rejects(() => tool.invoke(toolInput), /REVENUE_TASK_NOT_FOUND/);
  assert.equal(researchCalled, false);
});
