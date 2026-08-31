import type { ConnectorDefinition, GovernedApiCredentialRequest } from "@expadio/provider-registry";
import type { DurableArtifactSink } from "@expadio/storage";
import type {
  AiInvocationIntent,
  AiOperation,
  AiProposal,
  AiProvenance,
} from "./index.ts";
import type { AiProviderAdapter } from "./routing.ts";
import type { AiInputResolver } from "./input-resolution.ts";

export type AiCredentialRequest = GovernedApiCredentialRequest & {
  readonly operation: AiOperation;
};

export type AiApiTokenProvider = (request: AiCredentialRequest) => Promise<string>;

export interface GeminiAiAdapterOptions {
  readonly apiToken: AiApiTokenProvider;
  readonly artifactSink: DurableArtifactSink;
  readonly inputResolver: AiInputResolver;
  readonly modelKey?: string;
  readonly endpointBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => string;
}

const SUPPORTED_OPERATIONS = new Set([
  "GENERATE",
  "CLASSIFY",
  "SUMMARIZE",
  "EXTRACT",
  "EMBED",
  "TRANSLATE",
] as const);

export class GeminiAiAdapter implements AiProviderAdapter {
  readonly adapterKey = "gemini-v1";
  readonly #apiToken: AiApiTokenProvider;
  readonly #artifactSink: DurableArtifactSink;
  readonly #inputResolver: AiInputResolver;
  readonly #defaultModelKey: string;
  readonly #endpointBaseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => string;

  constructor(options: GeminiAiAdapterOptions) {
    this.#apiToken = options.apiToken;
    this.#artifactSink = options.artifactSink;
    this.#inputResolver = options.inputResolver;
    this.#defaultModelKey = options.modelKey ?? "gemini-2.0-flash";
    this.#endpointBaseUrl = (options.endpointBaseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/u, "");
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async invoke(input: {
    readonly intent: AiInvocationIntent;
    readonly connector: ConnectorDefinition;
  }): Promise<AiProposal> {
    const { intent, connector } = input;
    const modelKey = this.#defaultModelKey;
    const processedAt = this.#now();

    if (!SUPPORTED_OPERATIONS.has(intent.operation as never)) {
      throw new Error(`AI_OPERATION_UNSUPPORTED:${intent.operation}`);
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
      throw new Error("AI_CREDENTIAL_UNAVAILABLE: Leased token is empty");
    }

    if (intent.operation === "EMBED") {
      return this.#handleEmbed({ intent, connector, modelKey, token, processedAt });
    }

    return this.#handleGenerate({ intent, connector, modelKey, token, processedAt });
  }

  async #handleGenerate(params: {
    readonly intent: AiInvocationIntent;
    readonly connector: ConnectorDefinition;
    readonly modelKey: string;
    readonly token: string;
    readonly processedAt: string;
  }): Promise<AiProposal> {
    const { intent, connector, modelKey, token, processedAt } = params;

    const url = `${this.#endpointBaseUrl}/v1beta/models/${encodeURIComponent(modelKey)}:generateContent?key=${encodeURIComponent(token)}`;

    const resolvedInput = await this.#inputResolver.resolveText({
      tenantId: intent.tenantId,
      reference: intent.inputReference,
      purpose: intent.purpose,
      requiredResidencyTags: intent.governance.requiredResidencyTags,
      requiredComplianceTags: intent.governance.requiredComplianceTags,
    });
    const resolvedContext = intent.contextReference
      ? await this.#inputResolver.resolveText({
          tenantId: intent.tenantId,
          reference: intent.contextReference,
          purpose: intent.purpose,
          requiredResidencyTags: intent.governance.requiredResidencyTags,
          requiredComplianceTags: intent.governance.requiredComplianceTags,
        })
      : undefined;
    const promptText = resolvedInput.content;
    const requestBody: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature: intent.operation === "EXTRACT" || intent.operation === "CLASSIFY" ? 0.1 : 0.7,
      },
    };

    if (resolvedContext) {
      requestBody.systemInstruction = {
        parts: [{ text: `Context: ${resolvedContext.content}` }],
      };
    }

    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Client": "expadio-ai-gateway/1.0",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Network error");
      throw new Error(`AI_PROVIDER_ERROR: Gemini responded with status ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const firstCandidate = data.candidates?.[0];
    const generatedText = firstCandidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const totalTokens = data.usageMetadata?.totalTokenCount;

    const provenance: AiProvenance = {
      connectorKey: connector.connectorKey,
      providerKey: connector.providerKey,
      modelKey,
      promptConfigurationKey: intent.promptConfiguration.key,
      promptConfigurationVersion: intent.promptConfiguration.version,
      sourceReferences: [
        resolvedInput.sourceReference,
        ...(resolvedContext ? [resolvedContext.sourceReference] : []),
      ],
      processedAt,
      ...(connector.region !== undefined ? { region: connector.region } : {}),
      ...(data.usageMetadata === undefined
        ? {}
        : {
            providerUsage: {
              ...(data.usageMetadata.promptTokenCount === undefined
                ? {}
                : { inputTokens: data.usageMetadata.promptTokenCount }),
              ...(data.usageMetadata.candidatesTokenCount === undefined
                ? {}
                : { outputTokens: data.usageMetadata.candidatesTokenCount }),
              ...(totalTokens === undefined ? {} : { totalTokens }),
            },
          }),
    };

    const artifact = await this.#artifactSink.write({
      tenantId: intent.tenantId,
      artifactKind: "AI_TEXT",
      sourceKind: "AI_INVOCATION",
      sourceId: intent.invocationId,
      content: generatedText,
      contentType: "text/plain; charset=utf-8",
      providerKey: connector.providerKey,
      connectorKey: connector.connectorKey,
      modelKey: modelKey,
      correlationId: intent.correlationId,
      requiredResidencyTags: intent.governance.requiredResidencyTags,
      requiredComplianceTags: intent.governance.requiredComplianceTags,
    });

    return {
      invocationId: intent.invocationId,
      tenantId: intent.tenantId,
      status: intent.operation === "EXTRACT" || intent.operation === "CLASSIFY" ? "PROPOSAL" : "OBSERVATION",
      outputReference: artifact.contentReference,
      provenance,
    };
  }

  async #handleEmbed(params: {
    readonly intent: AiInvocationIntent;
    readonly connector: ConnectorDefinition;
    readonly modelKey: string;
    readonly token: string;
    readonly processedAt: string;
  }): Promise<AiProposal> {
    const { intent, connector, modelKey, token, processedAt } = params;

    const url = `${this.#endpointBaseUrl}/v1beta/models/${encodeURIComponent(modelKey)}:embedContent?key=${encodeURIComponent(token)}`;

    const resolvedInput = await this.#inputResolver.resolveText({
      tenantId: intent.tenantId,
      reference: intent.inputReference,
      purpose: intent.purpose,
      requiredResidencyTags: intent.governance.requiredResidencyTags,
      requiredComplianceTags: intent.governance.requiredComplianceTags,
    });

    const requestBody = {
      content: {
        parts: [{ text: resolvedInput.content }],
      },
    };

    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Network error");
      throw new Error(`AI_PROVIDER_ERROR: Gemini responded with status ${response.status}: ${errorText}`);
    }

    const embeddingPayload = await response.json() as unknown;
    const artifact = await this.#artifactSink.write({
      tenantId: intent.tenantId,
      artifactKind: "AI_EMBEDDING",
      sourceKind: "AI_INVOCATION",
      sourceId: intent.invocationId,
      content: JSON.stringify(embeddingPayload),
      contentType: "application/json",
      providerKey: connector.providerKey,
      connectorKey: connector.connectorKey,
      modelKey,
      correlationId: intent.correlationId,
      requiredResidencyTags: intent.governance.requiredResidencyTags,
      requiredComplianceTags: intent.governance.requiredComplianceTags,
    });

    const provenance: AiProvenance = {
      connectorKey: connector.connectorKey,
      providerKey: connector.providerKey,
      modelKey,
      promptConfigurationKey: intent.promptConfiguration.key,
      promptConfigurationVersion: intent.promptConfiguration.version,
      sourceReferences: [resolvedInput.sourceReference],
      processedAt,
      ...(connector.region !== undefined ? { region: connector.region } : {}),
    };

    return {
      invocationId: intent.invocationId,
      tenantId: intent.tenantId,
      status: "OBSERVATION",
      outputReference: artifact.contentReference,
      provenance,
    };
  }
}
