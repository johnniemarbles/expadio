import { randomUUID } from 'node:crypto';
import type { AiGateway, AiInvocationIntent } from '@expadio/ai-gateway';
import type { VersionedVoicePolicyReference, VoiceGateway, VoiceIntelligenceIntent } from '@expadio/voice-gateway';
import type { AgentToolAdapter, AgentToolAdapterInput, AgentToolObservation } from '../index.ts';

export interface CallbackBrief {
  readonly leadName: string;
  readonly callbackReason: string;
  readonly brandVoiceGuideline: string;
  readonly languageTag: string;
  readonly jurisdictionTags: readonly string[];
}

export interface CallbackBriefResolver {
  resolveBrief(inputReference: string, tenantId: string): Promise<CallbackBrief>;
}

export interface CallbackScript {
  readonly leadName: string;
  readonly scriptText: string;
  readonly audioReference: string;
}

export interface CallbackArtifactStore {
  save(input: { readonly tenantId: string; readonly key: string; readonly value: CallbackScript }): Promise<void>;
}

export interface VoiceCallbackPrepareToolOptions {
  readonly aiGateway: AiGateway;
  readonly voiceGateway: VoiceGateway;
  readonly briefResolver: CallbackBriefResolver;
  readonly artifactStore: CallbackArtifactStore;
  /**
   * Retention/redaction policy references are required, not defaulted: this
   * tool must never invent a placeholder policy key that doesn't correspond
   * to a real, configured governance policy. Callers wire these from
   * whatever the tenant's actual voice governance configuration names.
   */
  readonly recordingRetentionPolicy: VersionedVoicePolicyReference;
  readonly transcriptRetentionPolicy: VersionedVoicePolicyReference;
  readonly redactionPolicy: VersionedVoicePolicyReference;
  readonly promptConfigurationKey?: string;
  readonly promptConfigurationVersion?: number;
  readonly now?: () => string;
}

export const VOICE_CALLBACK_PREPARE_TOOL_KEY = 'voice.callback.prepare';

/**
 * Voice Agent, callback-preparation half: drafts a tailored outbound call
 * script (AiGateway.invoke, same as the editorial/outreach committees) and
 * synthesizes it into audio via the existing VoiceGateway
 * (operation: 'SYNTHESIZE'). OBSERVE effect: synthesizing a script into
 * audio before any call happens has no side effects and involves no
 * recording of a real conversation, so it needs no recording consent
 * evidence (VoiceGateway only requires that for TRANSCRIBE/
 * STREAM_CONVERSATION) and no prior approval to run.
 *
 * Deliberately not built here: transcribing a completed call and scoring
 * caller intent. VoiceIntelligenceObservation only ever returns a reference
 * (see deepgram-stt-adapter.ts, whose outputReference embeds only a
 * truncated transcript snippet) -- the real transcript text is resolved
 * through an artifact mechanism this change did not audit closely enough to
 * wire correctly. Building that half on a guessed resolution path would risk
 * silently reading the wrong data; it belongs in a follow-up once that
 * mechanism is confirmed.
 */
export function createVoiceCallbackPrepareTool(
  options: VoiceCallbackPrepareToolOptions,
): AgentToolAdapter {
  const promptKey = options.promptConfigurationKey ?? 'agent-runtime.voice-callback-committee';
  const promptVersion = options.promptConfigurationVersion ?? 1;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    toolKey: VOICE_CALLBACK_PREPARE_TOOL_KEY,
    effect: 'OBSERVE',
    async invoke(input: AgentToolAdapterInput): Promise<AgentToolObservation> {
      const brief = await options.briefResolver.resolveBrief(input.inputReference, input.tenantId);

      const scriptInvocationId = randomUUID();
      const scriptIntent: AiInvocationIntent = {
        invocationId: scriptInvocationId,
        tenantId: input.tenantId,
        operation: 'GENERATE',
        purpose: 'voice.callback.script',
        inputReference: scriptPrompt(brief),
        promptConfiguration: { key: promptKey, version: promptVersion },
        governance: {
          requiredResidencyTags: [],
          requiredComplianceTags: ['tcpa'],
        },
        idempotencyKey: `${scriptInvocationId}:script`,
        requestedAt: now(),
      };
      const scriptProposal = await options.aiGateway.invoke(scriptIntent);
      const scriptText = scriptProposal.outputContent?.value ?? '';

      const synthesisRequestId = randomUUID();
      const synthesisIntent: VoiceIntelligenceIntent = {
        requestId: synthesisRequestId,
        tenantId: input.tenantId,
        callId: input.executionId,
        operation: 'SYNTHESIZE',
        purpose: 'voice.callback.synthesize',
        inputReference: scriptText,
        languageTag: brief.languageTag,
        governance: {
          recordingRetentionPolicy: options.recordingRetentionPolicy,
          transcriptRetentionPolicy: options.transcriptRetentionPolicy,
          redactionPolicy: options.redactionPolicy,
          jurisdictionTags: brief.jurisdictionTags,
          requiredResidencyTags: [],
          requiredComplianceTags: ['tcpa'],
        },
        idempotencyKey: `${synthesisRequestId}:synthesize`,
        requestedAt: now(),
      };
      const synthesisObservation = await options.voiceGateway.invoke(synthesisIntent);

      const result: CallbackScript = {
        leadName: brief.leadName,
        scriptText,
        audioReference: synthesisObservation.outputReference,
      };

      const artifactKey = `voice-callback-script:${input.executionId}`;
      await options.artifactStore.save({ tenantId: input.tenantId, key: artifactKey, value: result });

      return {
        executionId: input.executionId,
        tenantId: input.tenantId,
        toolKey: VOICE_CALLBACK_PREPARE_TOOL_KEY,
        kind: 'OBSERVATION',
        outputReference: `memory://${artifactKey}`,
        sourceReferences: [input.contextBundleReference, synthesisObservation.outputReference],
        producedAt: new Date().toISOString(),
      };
    },
  };
}

function scriptPrompt(brief: CallbackBrief): string {
  return [
    'You are the Voice Agent for EXPADIO, preparing an outbound callback script.',
    `Lead: ${brief.leadName}.`,
    `Reason for callback: ${brief.callbackReason}.`,
    `Brand voice: ${brief.brandVoiceGuideline}.`,
    `Language: ${brief.languageTag}.`,
    'Draft a short, natural-sounding spoken script (not an email) for a real-time phone call.',
    'Open by acknowledging why the lead reached out, then propose a clear next step.',
  ].join('\n');
}
