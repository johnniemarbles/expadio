import type {
  AiGateway,
  AiInvocationIntent,
  AiOperation,
  AiProposal,
} from "@expadio/ai-gateway";
import type {
  GovernedActionIntent,
  GovernedActionExecutionAttempt,
} from "./index.ts";
import { governedActionExecutionAttemptKey } from "./execution.ts";

export interface GovernedAiActionConfiguration {
  readonly operation: AiOperation;
  readonly purpose: string;
  readonly inputReference: string;
  readonly contextReference?: string;
  readonly promptKey: string;
  readonly promptVersion: number;
  readonly requiredResidencyTags?: readonly string[];
  readonly requiredComplianceTags?: readonly string[];
  readonly maximumCostMinorUnits?: number;
}

export type GovernedAiActionResult =
  | {
      readonly status: "SUCCEEDED";
      readonly proposal: AiProposal;
      readonly approved: boolean;
      readonly attempt: GovernedActionExecutionAttempt;
    }
  | {
      readonly status: "FAILED";
      readonly reasonCode: string;
      readonly reason: string;
      readonly attempt: GovernedActionExecutionAttempt;
    };

export function parseGovernedAiActionConfiguration(
  config: Readonly<Record<string, unknown>>
): GovernedAiActionConfiguration {
  const operation = config.operation as AiOperation;
  const allowedOperations: readonly AiOperation[] = [
    "GENERATE",
    "CLASSIFY",
    "SUMMARIZE",
    "EXTRACT",
    "EMBED",
    "RERANK",
    "VISION_ANALYZE",
    "TRANSLATE",
  ];
  if (typeof operation !== "string" || !allowedOperations.includes(operation)) {
    throw new Error("AI_ACTION_OPERATION_INVALID");
  }
  const purpose = config.purpose;
  if (typeof purpose !== "string" || purpose.trim() === "") {
    throw new Error("AI_ACTION_PURPOSE_REQUIRED");
  }
  const inputReference = config.inputReference;
  if (typeof inputReference !== "string" || inputReference.trim() === "") {
    throw new Error("AI_ACTION_INPUT_REFERENCE_REQUIRED");
  }
  const contextReference = config.contextReference;
  if (
    contextReference !== undefined
    && (typeof contextReference !== "string" || contextReference.trim() === "")
  ) {
    throw new Error("AI_ACTION_CONTEXT_REFERENCE_INVALID");
  }
  const promptKey = typeof config.promptKey === "string" && config.promptKey.trim() !== ""
    ? config.promptKey.trim()
    : "prompt.default";
  const promptVersion = Number(config.promptVersion ?? 1);
  if (!Number.isInteger(promptVersion) || promptVersion <= 0) {
    throw new Error("AI_ACTION_PROMPT_VERSION_INVALID");
  }

  const maximumCostMinorUnits = config.maximumCostMinorUnits === undefined
    ? undefined
    : Number(config.maximumCostMinorUnits);
  if (
    maximumCostMinorUnits !== undefined
    && (!Number.isInteger(maximumCostMinorUnits) || maximumCostMinorUnits < 0)
  ) {
    throw new Error("AI_ACTION_MAXIMUM_COST_INVALID");
  }

  if (config.autoApproveConfidenceThreshold !== undefined) {
    throw new Error("AI_ACTION_AUTO_APPROVAL_UNSUPPORTED");
  }

  const requiredResidencyTags = config.requiredResidencyTags ?? [];
  const requiredComplianceTags = config.requiredComplianceTags ?? [];
  if (
    !Array.isArray(requiredResidencyTags)
    || !requiredResidencyTags.every((value) => typeof value === "string" && value.trim() !== "")
  ) {
    throw new Error("AI_ACTION_RESIDENCY_TAGS_INVALID");
  }
  if (
    !Array.isArray(requiredComplianceTags)
    || !requiredComplianceTags.every((value) => typeof value === "string" && value.trim() !== "")
  ) {
    throw new Error("AI_ACTION_COMPLIANCE_TAGS_INVALID");
  }

  return {
    operation,
    purpose: purpose.trim(),
    inputReference: inputReference.trim(),
    ...(contextReference === undefined ? {} : { contextReference: contextReference.trim() }),
    promptKey,
    promptVersion,
    requiredResidencyTags,
    requiredComplianceTags,
    ...(maximumCostMinorUnits !== undefined ? { maximumCostMinorUnits } : {}),
  };
}

export async function executeGovernedAiAction(input: {
  readonly intent: GovernedActionIntent;
  /** Persisted Action Intent UUID when executing through the production runtime. */
  readonly actionIntentId?: string;
  readonly aiGateway: AiGateway;
  readonly now?: () => Date;
}): Promise<GovernedAiActionResult> {
  const { intent, aiGateway } = input;
  const actionIntentId = input.actionIntentId ?? intent.idempotencyKey;
  const now = input.now ?? (() => new Date());
  const startedAt = now();

  if (intent.executorClass !== "AI_ACTION") {
    const completedAt = now();
    const attempt: GovernedActionExecutionAttempt = {
      tenantId: intent.tenantId,
      actionIntentId,
      executorClass: "AI_ACTION",
      attemptKey: governedActionExecutionAttemptKey({
        actionIntentId,
        phase: "INVOKE_AI",
      }),
      status: "REFUSED",
      startedAt,
      completedAt,
      reasonCode: "EXECUTOR_CLASS_MISMATCH",
      reason: `Expected AI_ACTION, received ${intent.executorClass}`,
      outputReference: null,
      metadata: {},
    };
    return {
      status: "FAILED",
      reasonCode: "EXECUTOR_CLASS_MISMATCH",
      reason: attempt.reason!,
      attempt,
    };
  }

  let aiConfig: GovernedAiActionConfiguration;
  try {
    aiConfig = parseGovernedAiActionConfiguration(intent.configuration);
  } catch (err: any) {
    const completedAt = now();
    const attempt: GovernedActionExecutionAttempt = {
      tenantId: intent.tenantId,
      actionIntentId,
      executorClass: "AI_ACTION",
      attemptKey: governedActionExecutionAttemptKey({
        actionIntentId,
        phase: "INVOKE_AI",
      }),
      status: "FAILED",
      startedAt,
      completedAt,
      reasonCode: "INVALID_AI_CONFIGURATION",
      reason: err.message,
      outputReference: null,
      metadata: {},
    };
    return {
      status: "FAILED",
      reasonCode: "INVALID_AI_CONFIGURATION",
      reason: err.message,
      attempt,
    };
  }

  const aiIntent: AiInvocationIntent = {
    invocationId: `inv_${intent.idempotencyKey}`,
    tenantId: intent.tenantId,
    operation: aiConfig.operation,
    purpose: aiConfig.purpose,
    inputReference: aiConfig.inputReference,
    ...(aiConfig.contextReference ? { contextReference: aiConfig.contextReference } : {}),
    promptConfiguration: {
      key: aiConfig.promptKey,
      version: aiConfig.promptVersion,
    },
    governance: {
      requiredResidencyTags: aiConfig.requiredResidencyTags ?? [],
      requiredComplianceTags: aiConfig.requiredComplianceTags ?? [],
      ...(aiConfig.maximumCostMinorUnits !== undefined ? { maximumCostMinorUnits: aiConfig.maximumCostMinorUnits } : {}),
    },
    idempotencyKey: intent.idempotencyKey,
    correlationId: intent.correlationId,
    requestedAt: startedAt.toISOString(),
  };

  try {
    const proposal = await aiGateway.invoke(aiIntent);
    const completedAt = now();
    const confidence = proposal.confidence;
    // Provider/model confidence, when present, is evidence only. It must never
    // authorize a consequential governed action by itself. A separate
    // policy/reviewer decision must convert an AI proposal into an approved
    // command.
    const isApproved = false;

    const attempt: GovernedActionExecutionAttempt = {
      tenantId: intent.tenantId,
      actionIntentId,
      executorClass: "AI_ACTION",
      attemptKey: governedActionExecutionAttemptKey({
        actionIntentId,
        phase: "INVOKE_AI",
      }),
      status: "SUCCEEDED",
      startedAt,
      completedAt,
      reasonCode: "AI_PROPOSAL_REQUIRES_REVIEW",
      reason: "AI proposal requires an independent governed approval decision.",
      outputReference: proposal.outputReference,
      metadata: {
        proposalStatus: proposal.status,
        confidence: confidence ?? null,
        modelKey: proposal.provenance.modelKey,
        connectorKey: proposal.provenance.connectorKey,
        costMinorUnits: proposal.provenance.costMinorUnits ?? null,
        estimatedCostMinorUnits: proposal.provenance.estimatedCostMinorUnits ?? null,
        providerUsage: proposal.provenance.providerUsage ?? null,
        approved: isApproved,
      },
    };

    return {
      status: "SUCCEEDED",
      proposal,
      approved: isApproved,
      attempt,
    };
  } catch (err: any) {
    const completedAt = now();
    const attempt: GovernedActionExecutionAttempt = {
      tenantId: intent.tenantId,
      actionIntentId,
      executorClass: "AI_ACTION",
      attemptKey: governedActionExecutionAttemptKey({
        actionIntentId,
        phase: "INVOKE_AI",
      }),
      status: "FAILED",
      startedAt,
      completedAt,
      reasonCode: "AI_INVOCATION_FAILED",
      reason: err.message,
      outputReference: null,
      metadata: {},
    };

    return {
      status: "FAILED",
      reasonCode: "AI_INVOCATION_FAILED",
      reason: err.message,
      attempt,
    };
  }
}
