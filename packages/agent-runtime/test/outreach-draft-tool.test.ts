import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiGateway, AiInvocationIntent, AiProposal } from '@expadio/ai-gateway';
import {
  createOutreachDraftTool,
  OUTREACH_DRAFT_TOOL_KEY,
  OutreachDraftError,
  type LeadDossierReader,
  type OutreachArtifactStore,
  type OutreachBrief,
  type OutreachBriefResolver,
  type OutreachSequenceResult,
} from '../src/committees/outreach-draft-tool.ts';
import type { LeadDossier } from '../src/committees/lead-osint-tool.ts';
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

const brief: OutreachBrief = {
  leadName: 'Acme Salons',
  dossierKey: 'lead-dossier:exec-osint-1',
  brandVoiceGuideline: 'Direct',
  caseStudyReferences: ['case-study://franchise-expansion-1'],
};

const dossier: LeadDossier = { companySize: '50-200', recentNews: ['Opened a second location'] };

const briefResolver: OutreachBriefResolver = { async resolveBrief() { return brief; } };

const toolInput: AgentToolAdapterInput = {
  executionId: 'exec-outreach-1',
  tenantId: 'tenant-1',
  subjectId: 'sub-1',
  agentId: 'agent-outreach',
  purpose: 'Draft outreach sequence',
  inputReference: 'ref:task:33333333-3333-3333-3333-333333333333:input',
  contextBundleReference: 'ref:task:33333333-3333-3333-3333-333333333333:context',
  idempotencyKey: 'idem-1',
  correlationId: 'corr-1',
};

let touchCounter = 0;
const gateway: AiGateway = {
  async invoke(intent: AiInvocationIntent): Promise<AiProposal> {
    touchCounter += 1;
    return proposalFor(intent, JSON.stringify({ subject: `Subject ${touchCounter}`, body: `Body ${touchCounter}` }));
  },
};

test('outreach draft tool has OBSERVE effect since it only drafts text', () => {
  const dossierReader: LeadDossierReader = { async getDossier() { return dossier; } };
  const artifactStore: OutreachArtifactStore = { async save() {} };
  const tool = createOutreachDraftTool({ aiGateway: gateway, briefResolver, dossierReader, artifactStore });
  assert.equal(tool.toolKey, OUTREACH_DRAFT_TOOL_KEY);
  assert.equal(tool.effect, 'OBSERVE');
});

test('outreach draft tool drafts a 3-touch sequence on an escalating schedule and persists it', async () => {
  touchCounter = 0;
  const dossierReader: LeadDossierReader = { async getDossier() { return dossier; } };
  const saved: Array<{ tenantId: string; key: string; value: OutreachSequenceResult }> = [];
  const artifactStore: OutreachArtifactStore = { async save(input) { saved.push(input); } };

  const tool = createOutreachDraftTool({ aiGateway: gateway, briefResolver, dossierReader, artifactStore });
  const observation = await tool.invoke(toolInput);

  assert.equal(observation.kind, 'OBSERVATION');
  assert.equal(observation.outputReference, `memory://outreach-sequence:${toolInput.executionId}`);

  assert.equal(saved.length, 1);
  const result = saved[0]?.value;
  assert.equal(result?.leadName, 'Acme Salons');
  assert.equal(result?.citedDossierKey, brief.dossierKey);
  assert.equal(result?.touches.length, 3);
  assert.deepEqual(result?.touches.map((t) => t.sendAfterDays), [0, 3, 7]);
  assert.equal(result?.touches[0]?.subject, 'Subject 1');
  assert.equal(result?.touches[2]?.subject, 'Subject 3');
});

test('outreach draft tool throws when the cited dossier cannot be found, without calling the AI gateway', async () => {
  const dossierReader: LeadDossierReader = { async getDossier() { return null; } };
  const artifactStore: OutreachArtifactStore = { async save() { throw new Error('should not be called'); } };
  let gatewayCalled = false;
  const failingGateway: AiGateway = {
    async invoke(intent) {
      gatewayCalled = true;
      return proposalFor(intent, '{}');
    },
  };

  const tool = createOutreachDraftTool({ aiGateway: failingGateway, briefResolver, dossierReader, artifactStore });

  await assert.rejects(
    () => tool.invoke(toolInput),
    (err: unknown) => err instanceof OutreachDraftError && err.code === 'OUTREACH_DOSSIER_NOT_FOUND',
  );
  assert.equal(gatewayCalled, false);
});

test('outreach draft tool cites the dossier and prior touch subjects in later prompts', async () => {
  const seenPrompts: string[] = [];
  const dossierReader: LeadDossierReader = { async getDossier() { return dossier; } };
  const artifactStore: OutreachArtifactStore = { async save() {} };
  let calls = 0;
  const trackingGateway: AiGateway = {
    async invoke(intent) {
      calls += 1;
      seenPrompts.push(intent.inputReference);
      return proposalFor(intent, JSON.stringify({ subject: `Subject ${calls}`, body: `Body ${calls}` }));
    },
  };

  const tool = createOutreachDraftTool({ aiGateway: trackingGateway, briefResolver, dossierReader, artifactStore });
  await tool.invoke(toolInput);

  assert.equal(seenPrompts.length, 3);
  assert.ok(seenPrompts[0]?.includes('Opened a second location'));
  assert.ok(seenPrompts[1]?.includes('Subject 1'));
  assert.ok(seenPrompts[2]?.includes('Subject 2'));
});
