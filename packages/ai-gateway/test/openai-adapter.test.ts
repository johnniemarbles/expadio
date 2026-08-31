import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorDefinition } from "@expadio/provider-registry";
import {
  OpenAiAiAdapter,
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
    sha256: "a".repeat(64),
    byteLength: typeof input.content === "string" ? input.content.length : input.content.byteLength,
  }),
};

const connector: ConnectorDefinition = {
  connectorKey: "connector.ai.openai.primary",
  providerType: "openai",
  providerKey: "openai",
  ownership: "PLATFORM",
  capabilityKeys: ["ai.generate", "ai.extract", "ai.embed"],
  residencyTags: ["US"],
  complianceTags: ["SOC2"],
  health: "HEALTHY",
  priority: 100,
  enabled: true,
  fallbackEnabled: false,
  region: "us-east-1",
};

const intent: AiInvocationIntent = {
  invocationId: "inv_openai_123",
  tenantId: "tenant_xyz",
  operation: "EXTRACT",
  purpose: "Extract dental codes",
  inputReference: "Procedure: D0150 Comprehensive oral evaluation",
  promptConfiguration: {
    key: "prompt.dental.codes",
    version: 2,
  },
  governance: {
    requiredResidencyTags: ["US"],
    requiredComplianceTags: ["SOC2"],
  },
  idempotencyKey: "idem_openai_999",
  correlationId: "corr-openai-999",
  requestedAt: "2026-08-30T12:00:00.000Z",
};

test("OpenAiAiAdapter invokes chat completions and returns validated proposal", async () => {
  let requestedUrl = "";
  let requestHeaders: Record<string, string> = {};
  let requestBody: any = null;

  const mockFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    const h = init?.headers as any;
    requestHeaders = h;
    requestBody = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ code: "D0150", category: "Diagnostic" }),
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 10,
          total_tokens: 25,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const adapter = new OpenAiAiAdapter({
    apiToken: async () => "mock-openai-key-abc",
    artifactSink,
    inputResolver,
    fetchImpl: mockFetch,
    now: () => "2026-08-30T12:00:02.000Z",
  });

  const proposal = await adapter.invoke({ intent, connector });

  assert.equal(requestedUrl, "https://api.openai.com/v1/chat/completions");
  assert.equal(requestHeaders["Authorization"], "Bearer mock-openai-key-abc");
  assert.equal(requestBody.model, "gpt-4o-mini");
  assert.equal(proposal.status, "PROPOSAL");
  assert.equal(proposal.provenance.modelKey, "gpt-4o-mini");
  assert.equal(proposal.provenance.costMinorUnits, undefined);
  assert.deepEqual(proposal.provenance.providerUsage, {
    inputTokens: 15,
    outputTokens: 10,
    totalTokens: 25,
  });

  const validation = validateAiProposal(intent, proposal);
  assert.equal(validation.valid, true);
});

test("OpenAiAiAdapter handles embeddings via /v1/embeddings", async () => {
  let requestedUrl = "";
  let requestBody: any = null;

  const mockFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        data: [{ embedding: [0.01, 0.02, 0.03] }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const adapter = new OpenAiAiAdapter({
    apiToken: async () => "mock-openai-key-abc",
    artifactSink,
    inputResolver,
    fetchImpl: mockFetch,
    now: () => "2026-08-30T12:00:02.000Z",
  });

  const embedIntent: AiInvocationIntent = {
    ...intent,
    operation: "EMBED",
  };

  const proposal = await adapter.invoke({ intent: embedIntent, connector });

  assert.equal(requestedUrl, "https://api.openai.com/v1/embeddings");
  assert.equal(requestBody.model, "text-embedding-3-small");
  assert.equal(proposal.status, "OBSERVATION");
  assert.equal(proposal.provenance.modelKey, "text-embedding-3-small");
  assert.equal(proposal.outputReference, `artifact://AI_EMBEDDING/${embedIntent.invocationId}`);

  const validation = validateAiProposal(embedIntent, proposal);
  assert.equal(validation.valid, true);
});

test("OpenAiAiAdapter resolves logical references before provider invocation", async () => {
  let requestBody: any = null;
  const logicalReference = "ref://clinical-note/note-123";

  const adapter = new OpenAiAiAdapter({
    apiToken: async () => "mock-openai-key",
    artifactSink,
    inputResolver: {
      resolveText: async (input) => ({
        content: input.reference === logicalReference ? "resolved clinical note" : input.reference,
        sourceReference: input.reference,
      }),
    },
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "provider result" } }],
          usage: { total_tokens: 10 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const resolvedIntent: AiInvocationIntent = {
    ...intent,
    inputReference: logicalReference,
    contextReference: undefined,
    operation: "GENERATE",
  };

  const proposal = await adapter.invoke({ intent: resolvedIntent, connector });

  assert.equal(requestBody.messages[0].content, "resolved clinical note");
  assert.deepEqual(proposal.provenance.sourceReferences, [logicalReference]);
});
