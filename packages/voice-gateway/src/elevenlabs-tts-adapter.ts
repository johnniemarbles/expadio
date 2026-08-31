import type { ConnectorDefinition } from "@expadio/provider-registry";
import type { DurableArtifactSink } from "@expadio/storage";
import type {
  VoiceIntelligenceIntent,
  VoiceIntelligenceObservation,
  VoiceIntelligenceProvenance,
} from "./index.ts";
import type { VoiceProviderAdapter } from "./routing.ts";
import type { VoiceApiTokenProvider } from "./deepgram-stt-adapter.ts";
import type { VoiceInputResolver } from "./input-resolution.ts";

export interface ElevenLabsTtsAdapterOptions {
  readonly apiToken: VoiceApiTokenProvider;
  readonly artifactSink: DurableArtifactSink;
  readonly inputResolver: VoiceInputResolver;
  readonly endpointBaseUrl?: string;
  readonly defaultVoiceId?: string;
  readonly modelKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => string;
}

export class ElevenLabsTtsAdapter implements VoiceProviderAdapter {
  readonly adapterKey = "elevenlabs-tts-v1";
  readonly #apiToken: VoiceApiTokenProvider;
  readonly #artifactSink: DurableArtifactSink;
  readonly #inputResolver: VoiceInputResolver;
  readonly #endpointBaseUrl: string;
  readonly #defaultVoiceId: string;
  readonly #modelKey: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => string;

  constructor(options: ElevenLabsTtsAdapterOptions) {
    this.#apiToken = options.apiToken;
    this.#artifactSink = options.artifactSink;
    this.#inputResolver = options.inputResolver;
    this.#endpointBaseUrl = (options.endpointBaseUrl ?? "https://api.elevenlabs.io/v1/text-to-speech").replace(/\/+$/u, "");
    this.#defaultVoiceId = options.defaultVoiceId ?? "21m00Tcm4TlvDq8ikWAM";
    this.#modelKey = options.modelKey ?? "eleven_multilingual_v2";
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async invoke(input: {
    readonly intent: VoiceIntelligenceIntent;
    readonly connector: ConnectorDefinition;
  }): Promise<VoiceIntelligenceObservation> {
    const { intent, connector } = input;
    const processedAt = this.#now();

    if (intent.operation !== "SYNTHESIZE") {
      throw new Error(`VOICE_OPERATION_UNSUPPORTED: ElevenLabsTtsAdapter only supports SYNTHESIZE, received ${intent.operation}`);
    }

    const token = await this.#apiToken({
      tenantId: intent.tenantId,
      connectorKey: connector.connectorKey,
      operation: intent.operation,
      purpose: intent.purpose,
      idempotencyKey: intent.idempotencyKey,
      requestedAt: intent.requestedAt,
    });

    if (!token || token.trim() === "") {
      throw new Error("VOICE_CREDENTIAL_UNAVAILABLE: Leased token is empty");
    }

    const voiceId = this.#defaultVoiceId;
    const url = `${this.#endpointBaseUrl}/${encodeURIComponent(voiceId)}`;

    const resolvedInput = await this.#inputResolver.resolveText({
      tenantId: intent.tenantId,
      reference: intent.inputReference,
      purpose: intent.purpose,
      requiredResidencyTags: intent.governance.requiredResidencyTags,
      requiredComplianceTags: intent.governance.requiredComplianceTags,
    });
    const textToSynthesize = resolvedInput.content;
    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": token,
        "User-Agent": "expadio-voice-gateway/1.0",
      },
      body: JSON.stringify({
        text: textToSynthesize,
        model_id: this.#modelKey,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Network error");
      throw new Error(`VOICE_PROVIDER_ERROR: ElevenLabs responded with status ${response.status}: ${errorText}`);
    }

    const audioBytes = new Uint8Array(await response.arrayBuffer());
    if (audioBytes.byteLength === 0) {
      throw new Error("VOICE_PROVIDER_OUTPUT_EMPTY: ElevenLabs returned no audio");
    }
    const contentType = response.headers.get("content-type") ?? "audio/mpeg";
    const artifact = await this.#artifactSink.write({
      tenantId: intent.tenantId,
      artifactKind: "VOICE_AUDIO",
      sourceKind: "VOICE_REQUEST",
      sourceId: intent.requestId,
      content: audioBytes,
      contentType,
      providerKey: connector.providerKey,
      connectorKey: connector.connectorKey,
      modelKey: this.#modelKey,
      correlationId: intent.correlationId,
      requiredResidencyTags: intent.governance.requiredResidencyTags,
      requiredComplianceTags: intent.governance.requiredComplianceTags,
    });

    const provenance: VoiceIntelligenceProvenance = {
      connectorKey: connector.connectorKey,
      providerKey: connector.providerKey,
      modelKey: this.#modelKey,
      sourceReferences: [resolvedInput.sourceReference],
      processedAt,
      ...(connector.region !== undefined ? { region: connector.region } : {}),

    };

    return {
      requestId: intent.requestId,
      tenantId: intent.tenantId,
      callId: intent.callId,
      operation: "SYNTHESIZE",
      outputReference: artifact.contentReference,
      provenance,
    };
  }
}
