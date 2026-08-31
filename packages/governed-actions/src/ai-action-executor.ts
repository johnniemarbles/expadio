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
  readonly autoApproveConfidenceThreshold?: number;
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
  const purpose = config.purpose as string;
  if (!purpose || typeof purpose !== "string") {
    throw new Error("AI_ACTION_PURPOSE_REQUIRED");
  }
  const inputReference = config.inputReference as string;
  if (!inputReference || typeof inputReference !== "string") {
    throw new Error("AI_ACTION_INPUT_REFERENCE_REQUIRED");
  }
  const promptKey = typeof config.promptKey === "string" && config.promptKey.trim() !== ""
    ? config.promptKey
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

  const autoApproveConfidenceThreshold = config.autoApproveConfidenceThreshold === undefined
    ? undefined
    : Number(config.autoApproveConfidenceThreshold);
  if (
    autoApproveConfidenceThreshold !== undefined
    && (
      !Number.isFinite(autoApproveConfidenceThreshold)
      || autoApproveConfidenceThreshold < 0
      || autoApproveConfidenceThreshold > 1
    )
  ) {
    throw new Error("AI_ACTION_CONFIDENCE_THRESHOLD_INVALID");
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
    purpose,
    inputReference,
    ...(config.contextReference ? { contextReference: String(config.contextReference) } : {}),
    promptKey,
    promptVersion,
    requiredResidencyTags,
    requiredComplianceTags,
    ...(maximumCostMinorUnits !== undefined ? { maximumCostMinorUnits } : {}),
    ...(autoApproveConfidenceThreshold !== undefined ? { autoApproveConfidenceThreshold } : {}),
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
        phase: "PARSE_CONFIG",
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
    requestedAt: startedAt.toISOString(),
  };

  try {
    const proposal = await aiGateway.invoke(aiIntent);
    const completedAt = now();
    const confidence = proposal.confidence ?? 0;
    // Provider/model confidence is evidence only. It must never authorize a
    // consequential governed action by itself. A separate policy/reviewer
    // decision must convert an AI proposal into an approved command.
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
      reason: `AI confidence ${confidence} is advisory evidence only; independent approval is required`,
      outputReference: proposal.outputReference,
      metadata: {
        proposalStatus: proposal.status,
        confidence,
        modelKey: proposal.provenance.modelKey,
        connectorKey: proposal.provenance.connectorKey,
        costMinorUnits: proposal.provenance.costMinorUnits,
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
