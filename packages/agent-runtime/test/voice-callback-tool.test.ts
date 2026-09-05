import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiGateway, AiInvocationIntent, AiProposal } from '@expadio/ai-gateway';
import type { VoiceGateway, VoiceIntelligenceIntent, VoiceIntelligenceObservation } from '@expadio/voice-gateway';
import {
  createVoiceCallbackPrepareTool,
  VOICE_CALLBACK_PREPARE_TOOL_KEY,
  type CallbackArtifactStore,
  type CallbackBrief,
  type CallbackBriefResolver,
  type CallbackScript,
} from '../src/committees/voice-callback-tool.ts';
import type { AgentToolAdapterInput } from '../src/index.ts';

function aiProposalFor(intent: AiInvocationIntent, text: string): AiProposal {
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

function voiceObservationFor(intent: VoiceIntelligenceIntent): VoiceIntelligenceObservation {
  return {
    requestId: intent.requestId,
    tenantId: intent.tenantId,
    callId: intent.callId,
    operation: intent.operation,
    outputReference: `ref://voice-synthesis/${intent.requestId}`,
    provenance: {
      connectorKey: 'fake-voice-connector',
      providerKey: 'fake-voice-provider',
      modelKey: 'fake-voice-model',
      sourceReferences: [intent.inputReference],
      processedAt: intent.requestedAt,
    },
  };
}

const brief: CallbackBrief = {
  leadName: 'Acme Salons',
  callbackReason: 'Requested pricing for multi-unit rollout',
  brandVoiceGuideline: 'Direct',
  languageTag: 'en-US',
  jurisdictionTags: ['US-CA'],
};

const briefResolver: CallbackBriefResolver = { async resolveBrief() { return brief; } };

const toolInput: AgentToolAdapterInput = {
  executionId: 'exec-voice-1',
  tenantId: 'tenant-1',
  subjectId: 'sub-1',
  agentId: 'agent-voice',
  purpose: 'Prepare callback',
  inputReference: 'ref:task:44444444-4444-4444-4444-444444444444:input',
  contextBundleReference: 'ref:task:44444444-4444-4444-4444-444444444444:context',
  idempotencyKey: 'idem-1',
  correlationId: 'corr-1',
};

const aiGateway: AiGateway = { async invoke(intent) { return aiProposalFor(intent, 'Hi, this is a callback about your pricing request.'); } };
const voiceGateway: VoiceGateway = { async invoke(intent) { return voiceObservationFor(intent); } };

const retentionOptions = {
  recordingRetentionPolicy: { key: 'voice.recording.default', version: 1 },
  transcriptRetentionPolicy: { key: 'voice.transcript.default', version: 1 },
  redactionPolicy: { key: 'voice.redaction.default', version: 1 },
};

test('voice callback prepare tool has OBSERVE effect since synthesizing a script has no side effects', () => {
  const artifactStore: CallbackArtifactStore = { async save() {} };
  const tool = createVoiceCallbackPrepareTool({ aiGateway, voiceGateway, briefResolver, artifactStore, ...retentionOptions });
  assert.equal(tool.toolKey, VOICE_CALLBACK_PREPARE_TOOL_KEY);
  assert.equal(tool.effect, 'OBSERVE');
});

test('voice callback prepare tool drafts a script, synthesizes it, and persists both references', async () => {
  const saved: Array<{ tenantId: string; key: string; value: CallbackScript }> = [];
  const artifactStore: CallbackArtifactStore = { async save(input) { saved.push(input); } };

  const tool = createVoiceCallbackPrepareTool({ aiGateway, voiceGateway, briefResolver, artifactStore, ...retentionOptions });
  const observation = await tool.invoke(toolInput);

  assert.equal(observation.kind, 'OBSERVATION');
  assert.equal(observation.outputReference, `memory://voice-callback-script:${toolInput.executionId}`);
  assert.equal(observation.sourceReferences[0], toolInput.contextBundleReference);
  assert.match(observation.sourceReferences[1] ?? '', /^ref:\/\/voice-synthesis\//);

  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.value.leadName, 'Acme Salons');
  assert.equal(saved[0]?.value.scriptText, 'Hi, this is a callback about your pricing request.');
  assert.match(saved[0]?.value.audioReference ?? '', /^ref:\/\/voice-synthesis\//);
});

test('voice callback prepare tool passes the drafted script and jurisdiction tags to the voice gateway', async () => {
  let seenIntent: VoiceIntelligenceIntent | null = null;
  const trackingVoiceGateway: VoiceGateway = {
    async invoke(intent) {
      seenIntent = intent;
      return voiceObservationFor(intent);
    },
  };
  const artifactStore: CallbackArtifactStore = { async save() {} };

  const tool = createVoiceCallbackPrepareTool({
    aiGateway,
    voiceGateway: trackingVoiceGateway,
    briefResolver,
    artifactStore,
    ...retentionOptions,
  });
  await tool.invoke(toolInput);

  assert.equal(seenIntent?.operation, 'SYNTHESIZE');
  assert.equal(seenIntent?.inputReference, 'Hi, this is a callback about your pricing request.');
  assert.deepEqual(seenIntent?.governance.jurisdictionTags, ['US-CA']);
  assert.deepEqual(seenIntent?.governance.recordingRetentionPolicy, retentionOptions.recordingRetentionPolicy);
  // Synthesizing a not-yet-happened call involves no real conversation
  // recording, so no consent evidence reference should be required or sent.
  assert.equal(seenIntent?.governance.recordingConsentEvidenceReference, undefined);
});

test('voice callback prepare tool propagates brief resolution failures without calling either gateway', async () => {
  const failingResolver: CallbackBriefResolver = {
    async resolveBrief() {
      throw new Error('VOICE_TASK_NOT_FOUND');
    },
  };
  let aiCalled = false;
  let voiceCalled = false;
  const trackingAiGateway: AiGateway = { async invoke(intent) { aiCalled = true; return aiProposalFor(intent, ''); } };
  const trackingVoiceGateway: VoiceGateway = { async invoke(intent) { voiceCalled = true; return voiceObservationFor(intent); } };
  const artifactStore: CallbackArtifactStore = { async save() {} };

  const tool = createVoiceCallbackPrepareTool({
    aiGateway: trackingAiGateway,
    voiceGateway: trackingVoiceGateway,
    briefResolver: failingResolver,
    artifactStore,
    ...retentionOptions,
  });

  await assert.rejects(() => tool.invoke(toolInput), /VOICE_TASK_NOT_FOUND/);
  assert.equal(aiCalled, false);
  assert.equal(voiceCalled, false);
});
