import assert from "node:assert/strict";
import test from "node:test";
import type { AiGateway, AiProposal } from "@expadio/ai-gateway";
import {
  executeGovernedAiAction,
  type GovernedActionIntent,
} from "../src/index.ts";

const intent: GovernedActionIntent = {
  tenantId: "tenant_dentex_001",
  sourceEventId: "evt_treatment_123",
  sourceEventType: "Treatment.Discharged",
  aggregateType: "Treatment",
  aggregateId: "treat_999",
  ruleKey: "rule.treatment.ai_followup_summary",
  executorClass: "AI_ACTION",
  actionKey: "action.ai.summarize",
  idempotencyKey: "evt_treatment_123:rule.treatment.ai_followup_summary:AI_ACTION",
  correlationId: "corr_001",
  causationId: "evt_treatment_123",
  requestedBySubjectId: "user_dentist_01",
  requestedAt: new Date("2026-08-30T12:00:00.000Z"),
  configuration: {
    operation: "SUMMARIZE",
    purpose: "Generate discharge clinical summary",
    inputReference: "Crown placement on tooth #19 completed without complications.",
    contextReference: "Patient allergic to penicillin.",
    promptKey: "prompt.clinical.discharge",
    promptVersion: 1,
  },
  policyDecision: {
    allowed: true,
    policyKeys: ["policy.ai.governance"],
    evidenceRefs: ["evidence://rule-match"],
    reasonCode: "POLICY_ALLOWED",
    evaluatedAt: new Date("2026-08-30T12:00:00.000Z"),
  },
};

test("executeGovernedAiAction never auto-approves from provider confidence alone", async () => {
  const mockProposal: AiProposal = {
    invocationId: `inv_${intent.idempotencyKey}`,
    tenantId: intent.tenantId,
    status: "OBSERVATION",
    outputReference: "ref://ai-output/inv_01#Discharge%20Summary",
    confidence: 0.95,
    provenance: {
      connectorKey: "connector.ai.gemini.us",
      providerKey: "google-ai",
      modelKey: "gemini-2.0-flash",
      promptConfigurationKey: "prompt.clinical.discharge",
      promptConfigurationVersion: 1,
      sourceReferences: [intent.configuration.inputReference as string],
      processedAt: "2026-08-30T12:00:01.000Z",
      costMinorUnits: 1,
    },
  };

  const mockGateway: AiGateway = {
    invoke: async (aiIntent) => {
      assert.equal(aiIntent.operation, "SUMMARIZE");
      assert.equal(aiIntent.inputReference, intent.configuration.inputReference);
      return mockProposal;
    },
  };

  const result = await executeGovernedAiAction({
    intent,
    aiGateway: mockGateway,
    now: () => new Date("2026-08-30T12:00:02.000Z"),
  });

  assert.equal(result.status, "SUCCEEDED");
  if (result.status === "SUCCEEDED") {
    assert.equal(result.approved, false);
    assert.equal(result.proposal.confidence, 0.95);
    assert.equal(result.attempt.status, "SUCCEEDED");
    assert.equal(result.attempt.reasonCode, "AI_PROPOSAL_REQUIRES_REVIEW");
  }
});

test("executeGovernedAiAction requires independent review regardless of confidence", async () => {
  const lowConfidenceProposal: AiProposal = {
    invocationId: `inv_${intent.idempotencyKey}`,
    tenantId: intent.tenantId,
    status: "PROPOSAL",
    outputReference: "ref://ai-output/low_conf",
    confidence: 0.75,
    provenance: {
      connectorKey: "connector.ai.gemini.us",
      providerKey: "google-ai",
      modelKey: "gemini-2.0-flash",
      promptConfigurationKey: "prompt.clinical.discharge",
      promptConfigurationVersion: 1,
      sourceReferences: ["input"],
      processedAt: "2026-08-30T12:00:01.000Z",
      costMinorUnits: 1,
    },
  };

  const mockGateway: AiGateway = {
    invoke: async () => lowConfidenceProposal,
  };

  const result = await executeGovernedAiAction({
    intent,
    aiGateway: mockGateway,
  });

  assert.equal(result.status, "SUCCEEDED");
  if (result.status === "SUCCEEDED") {
    assert.equal(result.approved, false);
    assert.equal(result.attempt.reasonCode, "AI_PROPOSAL_REQUIRES_REVIEW");
  }
});

test("executeGovernedAiAction refuses intent with executorClass mismatch", async () => {
  const mismatchIntent: GovernedActionIntent = {
    ...intent,
    executorClass: "COMMUNICATE",
  };

  const mockGateway: AiGateway = {
    invoke: async () => assert.fail("Should not invoke gateway"),
  };

  const result = await executeGovernedAiAction({
    intent: mismatchIntent,
    aiGateway: mockGateway,
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.reasonCode, "EXECUTOR_CLASS_MISMATCH");
  assert.equal(result.attempt.status, "REFUSED");
});


test("executeGovernedAiAction rejects confidence-only auto-approval configuration", async () => {
  const invalidIntent: GovernedActionIntent = {
    ...intent,
    configuration: {
      ...intent.configuration,
      autoApproveConfidenceThreshold: 7,
    },
  };

  const mockGateway: AiGateway = {
    invoke: async () => assert.fail("Should not invoke gateway"),
  };

  const result = await executeGovernedAiAction({
    intent: invalidIntent,
    aiGateway: mockGateway,
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.reasonCode, "INVALID_AI_CONFIGURATION");
  assert.match(result.reason, /AUTO_APPROVAL_UNSUPPORTED/);
});

test("executeGovernedAiAction rejects invalid operations before provider invocation", async () => {
  const invalidIntent: GovernedActionIntent = {
    ...intent,
    configuration: {
      ...intent.configuration,
      operation: "BANANA",
    },
  };

  const mockGateway: AiGateway = {
    invoke: async () => assert.fail("Should not invoke gateway"),
  };

  const result = await executeGovernedAiAction({
    intent: invalidIntent,
    aiGateway: mockGateway,
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.reasonCode, "INVALID_AI_CONFIGURATION");
  assert.match(result.reason, /OPERATION_INVALID/);
});


test("executeGovernedAiAction binds attempts to the persisted Action Intent ID", async () => {
  const persistedActionIntentId = "11111111-1111-4111-8111-111111111111";
  const mockGateway: AiGateway = {
    invoke: async () => ({
      invocationId: `inv_${intent.idempotencyKey}`,
      tenantId: intent.tenantId,
      status: "PROPOSAL",
      outputReference: "artifact://AI_TEXT/inv-persisted",
      confidence: 0.99,
      provenance: {
        connectorKey: "connector.ai.openai.us",
        providerKey: "openai",
        modelKey: "gpt-4o-mini",
        promptConfigurationKey: "prompt.clinical.discharge",
        promptConfigurationVersion: 1,
        sourceReferences: ["ref://input/1"],
        processedAt: "2026-08-31T02:00:00.000Z",
        costMinorUnits: 1,
      },
    }),
  };

  const result = await executeGovernedAiAction({
    intent,
    actionIntentId: persistedActionIntentId,
    aiGateway: mockGateway,
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.attempt.actionIntentId, persistedActionIntentId);
  assert.match(result.attempt.attemptKey, new RegExp(persistedActionIntentId));
});


test("executeGovernedAiAction rejects malformed context references before provider invocation", async () => {
  const invalidIntent: GovernedActionIntent = {
    ...intent,
    configuration: {
      ...intent.configuration,
      contextReference: { unsafe: true },
    },
  };

  const mockGateway: AiGateway = {
    invoke: async () => assert.fail("Should not invoke gateway"),
  };

  const result = await executeGovernedAiAction({
    intent: invalidIntent,
    aiGateway: mockGateway,
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.reasonCode, "INVALID_AI_CONFIGURATION");
  assert.match(result.reason, /AI_ACTION_CONTEXT_REFERENCE_INVALID/);
});


test("executeGovernedAiAction uses one replay identity for configuration refusal and invocation", async () => {
  const invalidIntent: GovernedActionIntent = {
    ...intent,
    configuration: {
      ...intent.configuration,
      operation: "INVALID",
    },
  };
  const persistedActionIntentId = "22222222-2222-4222-8222-222222222222";
  const mockGateway: AiGateway = {
    invoke: async () => assert.fail("Invalid configuration must not invoke AI"),
  };

  const result = await executeGovernedAiAction({
    intent: invalidIntent,
    actionIntentId: persistedActionIntentId,
    aiGateway: mockGateway,
  });

  assert.equal(result.status, "FAILED");
  assert.equal(
    result.attempt.attemptKey,
    governedActionExecutionAttemptKey({
      actionIntentId: persistedActionIntentId,
      phase: "INVOKE_AI",
    }),
  );
});
