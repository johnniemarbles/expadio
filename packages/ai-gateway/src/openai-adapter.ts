import type { ConnectorDefinition } from "@expadio/provider-registry";
import type { DurableArtifactSink } from "@expadio/storage";
import type {
  AiInvocationIntent,
  AiProposal,
  AiProvenance,
} from "./index.ts";
import type { AiProviderAdapter } from "./routing.ts";
import type { AiApiTokenProvider } from "./gemini-adapter.ts";
import type { AiInputResolver } from "./input-resolution.ts";

export interface OpenAiAiAdapterOptions {
  readonly apiToken: AiApiTokenProvider;
  readonly artifactSink: DurableArtifactSink;
  readonly inputResolver: AiInputResolver;
  readonly modelKey?: string;
  readonly endpointBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => string;
}

export class OpenAiAiAdapter implements AiProviderAdapter {
  readonly adapterKey = "openai-v1";
  readonly #apiToken: AiApiTokenProvider;
  readonly #artifactSink: DurableArtifactSink;
  readonly #inputResolver: AiInputResolver;
  readonly #defaultModelKey: string;
  readonly #endpointBaseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => string;

  constructor(options: OpenAiAiAdapterOptions) {
    this.#apiToken = options.apiToken;
    this.#artifactSink = options.artifactSink;
    this.#inputResolver = options.inputResolver;
    this.#defaultModelKey = options.modelKey ?? "gpt-4o-mini";
    this.#endpointBaseUrl = (options.endpointBaseUrl ?? "https://api.openai.com/v1").replace(/\/+$/u, "");
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

    return this.#handleChat({ intent, connector, modelKey, token, processedAt });
  }

  async #handleChat(params: {
    readonly intent: AiInvocationIntent;
    readonly connector: ConnectorDefinition;
    readonly modelKey: string;
    readonly token: string;
    readonly processedAt: string;
  }): Promise<AiProposal> {
    const { intent, connector, modelKey, token, processedAt } = params;
    const url = `${this.#endpointBaseUrl}/chat/completions`;

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

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (resolvedContext) {
      messages.push({
        role: "system",
        content: `Context: ${resolvedContext.content}`,
      });
    }
    messages.push({
      role: "user",
      content: resolvedInput.content,
    });

    const requestBody = {
      model: modelKey,
      messages,
      temperature: intent.operation === "EXTRACT" || intent.operation === "CLASSIFY" ? 0.1 : 0.7,
    };

    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "expadio-ai-gateway/1.0",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Network error");
      throw new Error(`AI_PROVIDER_ERROR: OpenAI responded with status ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = data.choices?.[0];
    const generatedText = choice?.message?.content ?? "";
    const totalTokens = data.usage?.total_tokens;

    const provenance: AiProvenance = {
      connectorKey: connector.connectorKey,
      providerKey: connector.providerKey,
      modelKey: embeddingModelKey,
      promptConfigurationKey: intent.promptConfiguration.key,
      promptConfigurationVersion: intent.promptConfiguration.version,
      sourceReferences: [
        resolvedInput.sourceReference,
        ...(resolvedContext ? [resolvedContext.sourceReference] : []),
      ],
      processedAt,
      ...(connector.region !== undefined ? { region: connector.region } : {}),
      ...(data.usage === undefined
        ? {}
        : {
            providerUsage: {
              ...(data.usage.prompt_tokens === undefined
                ? {}
                : { inputTokens: data.usage.prompt_tokens }),
              ...(data.usage.completion_tokens === undefined
                ? {}
                : { outputTokens: data.usage.completion_tokens }),
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
    const url = `${this.#endpointBaseUrl}/embeddings`;

    const resolvedInput = await this.#inputResolver.resolveText({
      tenantId: intent.tenantId,
      reference: intent.inputReference,
      purpose: intent.purpose,
      requiredResidencyTags: intent.governance.requiredResidencyTags,
      requiredComplianceTags: intent.governance.requiredComplianceTags,
    });

    const embeddingModelKey =
      modelKey === "gpt-4o-mini" ? "text-embedding-3-small" : modelKey;
    const requestBody = {
      model: embeddingModelKey,
      input: resolvedInput.content,
    };

    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Network error");
      throw new Error(`AI_PROVIDER_ERROR: OpenAI responded with status ${response.status}: ${errorText}`);
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
      modelKey: embeddingModelKey,
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
