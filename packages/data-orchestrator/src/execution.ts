import {
  validateDataOrchestrationIntent,
  validateDataOrchestrationObservation,
  type DataIntelligenceOrchestrator,
  type DataOrchestrationIntent,
  type DataOrchestrationObservation,
  type DataOrchestrationStageOutput,
  type IntelligenceStage,
} from './index.ts';

export interface IntelligenceStageHandler {
  readonly stage: IntelligenceStage;
  execute(input: {
    readonly intent: DataOrchestrationIntent;
    readonly priorOutputs: readonly DataOrchestrationStageOutput[];
  }): Promise<DataOrchestrationStageOutput>;
}

export type DataOrchestratorExecutionErrorCode =
  | 'DATA_ORCHESTRATION_INTENT_INVALID'
  | 'DATA_STAGE_HANDLER_MISSING'
  | 'DATA_STAGE_HANDLER_DUPLICATE'
  | 'DATA_STAGE_OUTPUT_INVALID'
  | 'DATA_ORCHESTRATION_OBSERVATION_INVALID';

export class DataOrchestratorExecutionError extends Error {
  readonly code: DataOrchestratorExecutionErrorCode;

  constructor(code: DataOrchestratorExecutionErrorCode, message: string) {
    super(message);
    this.name = 'DataOrchestratorExecutionError';
    this.code = code;
  }
}

/**
 * Executes only explicitly requested stages. Handlers return references, not
 * direct CRM mutations; proposal stages remain subject to downstream command
 * validation, authorization, and human approval where required.
 */
export class ConfiguredDataIntelligenceOrchestrator
  implements DataIntelligenceOrchestrator {
  readonly #handlers: ReadonlyMap<IntelligenceStage, IntelligenceStageHandler>;
  readonly #clock: () => string;

  constructor(
    handlers: readonly IntelligenceStageHandler[],
    clock: () => string = () => new Date().toISOString(),
  ) {
    const registry = new Map<IntelligenceStage, IntelligenceStageHandler>();
    for (const handler of handlers) {
      if (registry.has(handler.stage)) {
        throw new DataOrchestratorExecutionError(
          'DATA_STAGE_HANDLER_DUPLICATE',
          `More than one handler is registered for ${handler.stage}.`,
        );
      }
      registry.set(handler.stage, handler);
    }
    this.#handlers = registry;
    this.#clock = clock;
  }

  async execute(
    intent: DataOrchestrationIntent,
  ): Promise<DataOrchestrationObservation> {
    const intentValidation = validateDataOrchestrationIntent(intent);
    if (!intentValidation.valid) {
      throw new DataOrchestratorExecutionError(
        'DATA_ORCHESTRATION_INTENT_INVALID',
        intentValidation.issues.map((issue) => issue.code).join(','),
      );
    }

    const stageOutputs: DataOrchestrationStageOutput[] = [];
    for (const stage of intent.stages) {
      const handler = this.#handlers.get(stage);
      if (handler === undefined) {
        throw new DataOrchestratorExecutionError(
          'DATA_STAGE_HANDLER_MISSING',
          `No handler is registered for ${stage}.`,
        );
      }
      const output = await handler.execute({
        intent,
        priorOutputs: stageOutputs.map((candidate) => ({ ...candidate })),
      });
      if (output.stage !== stage || output.outputReference.trim() === '') {
        throw new DataOrchestratorExecutionError(
          'DATA_STAGE_OUTPUT_INVALID',
          `Handler ${stage} returned an invalid output.`,
        );
      }
      stageOutputs.push({ ...output });
    }

    const observation: DataOrchestrationObservation = {
      workId: intent.workId,
      tenantId: intent.tenantId,
      status: intent.stages.some(isProposalStage)
        ? 'PROPOSAL'
        : 'OBSERVATION',
      stageOutputs,
      provenance: {
        sourceReferences: [
          intent.sourceEventReference,
          ...stageOutputs.map((output) => output.outputReference),
        ],
        completedAt: this.#clock(),
      },
    };
    const observationValidation = validateDataOrchestrationObservation(
      intent,
      observation,
    );
    if (!observationValidation.valid) {
      throw new DataOrchestratorExecutionError(
        'DATA_ORCHESTRATION_OBSERVATION_INVALID',
        observationValidation.issues.map((issue) => issue.code).join(','),
      );
    }
    return observation;
  }
}

function isProposalStage(stage: IntelligenceStage): boolean {
  return stage === 'PROPOSE_PROJECTION'
    || stage === 'PROPOSE_WORKFLOW_TRIGGER';
}
