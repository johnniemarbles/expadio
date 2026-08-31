import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorDefinition } from "@expadio/provider-registry";
import {
  GeminiAiAdapter,
  validateAiProposal,
  type AiInvocationIntent,
} from "../src/index.ts";

const inputResolver = {
  resolveText: async (input: any) => ({
    content: input.reference,
    sourceReference: input.reference,
  }),
};

const artifactSink = {
  write: async (input: any) => ({
    contentReference: `artifact://${input.artifactKind}/${input.sourceId}`,
    sha256: "b".repeat(64),
    byteLength: typeof input.content === "string" ? input.content.length : input.content.byteLength,
  }),
};

const connector: ConnectorDefinition = {
  connectorKey: "connector.ai.gemini.primary",
  providerType: "gemini",
  providerKey: "google-ai",
  ownership: "PLATFORM",
  capabilityKeys: ["ai.generate", "ai.extract", "ai.embed"],
  residencyTags: ["US"],
  complianceTags: ["HIPAA"],
  health: "HEALTHY",
  priority: 100,
  enabled: true,
  fallbackEnabled: false,
  region: "us-central1",
};

const intent: AiInvocationIntent = {
  invocationId: "inv_12345",
  tenantId: "tenant_abc",
  operation: "GENERATE",
  purpose: "Draft patient summary",
  inputReference: "Patient exhibits symptoms of mild gingivitis.",
  contextReference: "Clinical history: Patient visited 6 months ago.",
  promptConfiguration: {
    key: "prompt.clinical.summary",
    version: 1,
  },
  governance: {
    requiredResidencyTags: ["US"],
    requiredComplianceTags: ["HIPAA"],
    maximumCostMinorUnits: 50,
  },
  idempotencyKey: "idem_999",
  correlationId: "corr-gemini-999",
  requestedAt: "2026-08-30T12:00:00.000Z",
};

test("GeminiAiAdapter invokes generateContent, parses response and sets provenance", async () => {
  let requestedUrl = "";
  let requestHeaders: HeadersInit = {};
  let requestBody: any = null;

  const mockFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestHeaders = init?.headers ?? {};
    requestBody = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "Extracted clinical summary: mild gingivitis." }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 15,
          totalTokenCount: 35,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const adapter = new GeminiAiAdapter({
    apiToken: async () => "mock-gemini-key-123",
    artifactSink,
    inputResolver,
    fetchImpl: mockFetch,
    now: () => "2026-08-30T12:00:01.000Z",
  });

  const proposal = await adapter.invoke({ intent, connector });

  assert.ok(requestedUrl.includes("gemini-2.0-flash:generateContent"));
  assert.ok(requestedUrl.includes("key=mock-gemini-key-123"));
  assert.equal(requestBody.contents[0].parts[0].text, intent.inputReference);
  assert.equal(requestBody.systemInstruction.parts[0].text, `Context: ${intent.contextReference}`);

  assert.equal(proposal.invocationId, intent.invocationId);
  assert.equal(proposal.tenantId, intent.tenantId);
  assert.equal(proposal.status, "OBSERVATION");
  assert.equal(proposal.provenance.connectorKey, connector.connectorKey);
  assert.equal(proposal.provenance.providerKey, connector.providerKey);
  assert.equal(proposal.provenance.modelKey, "gemini-2.0-flash");
  assert.equal(proposal.provenance.costMinorUnits, undefined);
  assert.deepEqual(proposal.provenance.providerUsage, {
    inputTokens: 20,
    outputTokens: 15,
    totalTokens: 35,
  });
  assert.deepEqual(proposal.provenance.sourceReferences, [intent.inputReference, intent.contextReference]);

  const validation = validateAiProposal(intent, proposal);
  assert.equal(validation.valid, true);
});

test("GeminiAiAdapter handles EMBED operation with embedContent API", async () => {
  let requestedUrl = "";

  const mockFetch: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        embedding: {
          values: [0.1, 0.2, 0.3],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const adapter = new GeminiAiAdapter({
    apiToken: async () => "mock-gemini-key-123",
    artifactSink,
    inputResolver,
    fetchImpl: mockFetch,
    now: () => "2026-08-30T12:00:01.000Z",
  });

  const embedIntent: AiInvocationIntent = {
    ...intent,
    operation: "EMBED",
  };

  const proposal = await adapter.invoke({ intent: embedIntent, connector });

  assert.ok(requestedUrl.includes("gemini-2.0-flash:embedContent"));
  assert.equal(proposal.outputReference, `artifact://AI_EMBEDDING/${embedIntent.invocationId}`);
  assert.equal(proposal.confidence, undefined);

  const validation = validateAiProposal(embedIntent, proposal);
  assert.equal(validation.valid, true);
});

test("GeminiAiAdapter rejects empty leased token with clear error", async () => {
  const adapter = new GeminiAiAdapter({
    apiToken: async () => "",
    artifactSink,
    inputResolver,
  });

  await assert.rejects(
    () => adapter.invoke({ intent, connector }),
    /AI_CREDENTIAL_UNAVAILABLE/
  );
});

test("GeminiAiAdapter throws on provider error response", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response("Quota exceeded", { status: 429 });
  };

  const adapter = new GeminiAiAdapter({
    apiToken: async () => "mock-key",
    artifactSink,
    inputResolver,
    fetchImpl: mockFetch,
  });

  await assert.rejects(
    () => adapter.invoke({ intent, connector }),
    /AI_PROVIDER_ERROR: Gemini responded with status 429/
  );
});

test("GeminiAiAdapter rejects unsupported modalities before credential acquisition", async () => {
  const adapter = new GeminiAiAdapter({
    apiToken: async () => assert.fail("Unsupported operations must not acquire credentials"),
    artifactSink,
    inputResolver,
    fetchImpl: async () => assert.fail("Unsupported operations must not call the provider"),
  });

  await assert.rejects(
    adapter.invoke({
      intent: { ...intent, operation: "RERANK" },
      connector,
    }),
    /AI_OPERATION_UNSUPPORTED:RERANK/,
  );
});

test("GeminiAiAdapter rejects empty successful provider output before artifact persistence", async () => {
  let artifactWrites = 0;
  const adapter = new GeminiAiAdapter({
    apiToken: async () => "mock-gemini-key",
    artifactSink: {
      write: async () => {
        artifactWrites += 1;
        return assert.fail("Empty provider output must not be persisted");
      },
    },
    inputResolver,
    fetchImpl: async () => new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "   " }] } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  });

  await assert.rejects(
    adapter.invoke({ intent, connector }),
    /AI_PROVIDER_OUTPUT_EMPTY: Gemini returned no usable text/,
  );
  assert.equal(artifactWrites, 0);
});

test("GeminiAiAdapter rejects empty embedding vectors before artifact persistence", async () => {
  let artifactWrites = 0;
  const adapter = new GeminiAiAdapter({
    apiToken: async () => "mock-gemini-key",
    artifactSink: {
      write: async () => {
        artifactWrites += 1;
        return assert.fail("Empty embedding must not be persisted");
      },
    },
    inputResolver,
    fetchImpl: async () => new Response(
      JSON.stringify({ embedding: { values: [] } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  });

  await assert.rejects(
    adapter.invoke({
      intent: { ...intent, operation: "EMBED" },
      connector,
    }),
    /AI_PROVIDER_OUTPUT_EMPTY: Gemini returned no embedding vector/,
  );
  assert.equal(artifactWrites, 0);
});
