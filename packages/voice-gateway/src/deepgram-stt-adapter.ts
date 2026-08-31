import type { ConnectorDefinition, GovernedApiCredentialRequest } from "@expadio/provider-registry";
import type { DurableArtifactSink } from "@expadio/storage";
import type {
  VoiceIntelligenceIntent,
  VoiceIntelligenceObservation,
  VoiceIntelligenceOperation,
  VoiceIntelligenceProvenance,
} from "./index.ts";
import type { VoiceProviderAdapter } from "./routing.ts";
import type { VoiceInputResolver } from "./input-resolution.ts";

export type VoiceCredentialRequest = GovernedApiCredentialRequest & {
  readonly operation: VoiceIntelligenceOperation;
};

export type VoiceApiTokenProvider = (request: VoiceCredentialRequest) => Promise<string>;

export interface DeepgramSttAdapterOptions {
  readonly apiToken: VoiceApiTokenProvider;
  readonly artifactSink: DurableArtifactSink;
  readonly inputResolver: VoiceInputResolver;
  readonly endpointBaseUrl?: string;
  readonly modelKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => string;
}

export class DeepgramSttAdapter implements VoiceProviderAdapter {
  readonly adapterKey = "deepgram-stt-v1";
  readonly #apiToken: VoiceApiTokenProvider;
  readonly #artifactSink: DurableArtifactSink;
  readonly #inputResolver: VoiceInputResolver;
  readonly #endpointBaseUrl: string;
  readonly #modelKey: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => string;

  constructor(options: DeepgramSttAdapterOptions) {
    this.#apiToken = options.apiToken;
    this.#artifactSink = options.artifactSink;
    this.#inputResolver = options.inputResolver;
    this.#endpointBaseUrl = (options.endpointBaseUrl ?? "https://api.deepgram.com/v1/listen").replace(/\/+$/u, "");
    this.#modelKey = options.modelKey ?? "nova-2";
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async invoke(input: {
    readonly intent: VoiceIntelligenceIntent;
    readonly connector: ConnectorDefinition;
  }): Promise<VoiceIntelligenceObservation> {
    const { intent, connector } = input;
    const processedAt = this.#now();

    if (intent.operation !== "TRANSCRIBE") {
      throw new Error(`VOICE_OPERATION_UNSUPPORTED: DeepgramSttAdapter only supports TRANSCRIBE, received ${intent.operation}`);
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

    const resolvedInput = await this.#inputResolver.resolveProviderFetchUrl({
      tenantId: intent.tenantId,
      reference: intent.inputReference,
      purpose: intent.purpose,
      requiredResidencyTags: intent.governance.requiredResidencyTags,
      requiredComplianceTags: intent.governance.requiredComplianceTags,
    });
    const url = `${this.#endpointBaseUrl}?model=${encodeURIComponent(this.#modelKey)}&language=${encodeURIComponent(intent.languageTag)}&smart_format=true&punctuate=true`;

    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
        "User-Agent": "expadio-voice-gateway/1.0",
      },
      body: JSON.stringify({
        url: resolvedInput.providerFetchUrl,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Network error");
      throw new Error(`VOICE_PROVIDER_ERROR: Deepgram responded with status ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript?: string;
            confidence?: number;
          }>;
        }>;
      };
      metadata?: {
        duration?: number;
      };
    };

    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    const durationSeconds = data.metadata?.duration;
    const durationMilliseconds = durationSeconds === undefined
      ? undefined
      : Math.round(durationSeconds * 1000);
    // Cost is an estimate only when provider duration is available.
    const costMinorUnits = durationSeconds === undefined
      ? undefined
      : Math.max(1, Math.ceil((durationSeconds / 60) * 0.5));

    const artifact = await this.#artifactSink.write({
      tenantId: intent.tenantId,
      artifactKind: "VOICE_TRANSCRIPT",
      sourceKind: "VOICE_REQUEST",
      sourceId: intent.requestId,
      content: transcript,
      contentType: "text/plain; charset=utf-8",
      providerKey: connector.providerKey,
      connectorKey: connector.connectorKey,
      modelKey: this.#modelKey,
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
      ...(durationMilliseconds !== undefined ? { audioDurationMilliseconds: durationMilliseconds } : {}),
      ...(costMinorUnits !== undefined ? { costMinorUnits } : {}),
    };

    return {
      requestId: intent.requestId,
      tenantId: intent.tenantId,
      callId: intent.callId,
      operation: "TRANSCRIBE",
      outputReference: artifact.contentReference,
      provenance,
    };
  }
}
