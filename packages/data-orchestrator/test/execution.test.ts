import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConfiguredDataIntelligenceOrchestrator,
  DataOrchestratorExecutionError,
  type DataOrchestrationIntent,
  type IntelligenceStageHandler,
} from '../src/index.ts';

const intent: DataOrchestrationIntent = {
  workId: 'work-1',
  tenantId: 'tenant-1',
  purpose: 'Create a governed projection proposal.',
  sourceEventReference: 'event://tenant-1/source-1',
  stages: [
    'EXTRACT',
    'VALIDATE_ONTOLOGY',
    'APPLY_POLICY',
    'PROPOSE_PROJECTION',
  ],
  ontology: { key: 'ontology', version: 2 },
  policies: [{ key: 'projection', version: 1 }],
  idempotencyKey: 'orchestrate:source-1:v2',
  requestedBySubjectId: 'workflow-1',
  requestedAt: '2026-08-25T15:00:00.000Z',
  correlationId: 'correlation-1',
  evidenceRefs: ['event:source-1'],
};

function handler(
  stage: IntelligenceStageHandler['stage'],
  calls: string[],
): IntelligenceStageHandler {
  return {
    stage,
    async execute({ priorOutputs }) {
      calls.push(`${stage}:${priorOutputs.length}`);
      return {
        stage,
        outputReference: `object://tenant-1/${stage.toLocaleLowerCase()}`,
      };
    },
  };
}

test('executes registered stages in deterministic plan order', async () => {
  const calls: string[] = [];
  const orchestrator = new ConfiguredDataIntelligenceOrchestrator(
    intent.stages.map((stage) => handler(stage, calls)),
    () => '2026-08-25T15:00:05.000Z',
  );

  const result = await orchestrator.execute(intent);

  assert.equal(result.status, 'PROPOSAL');
  assert.deepEqual(calls, [
    'EXTRACT:0',
    'VALIDATE_ONTOLOGY:1',
    'APPLY_POLICY:2',
    'PROPOSE_PROJECTION:3',
  ]);
  assert.equal(result.stageOutputs.length, 4);
  assert.equal(result.provenance.sourceReferences.length, 5);
});

test('stops before execution when a requested handler is missing', async () => {
  const calls: string[] = [];
  const orchestrator = new ConfiguredDataIntelligenceOrchestrator([
    handler('EXTRACT', calls),
  ]);

  await assert.rejects(
    () => orchestrator.execute(intent),
    (error: unknown) =>
      error instanceof DataOrchestratorExecutionError
      && error.code === 'DATA_STAGE_HANDLER_MISSING',
  );
  assert.deepEqual(calls, ['EXTRACT:0']);
});

test('rejects a handler that returns another stage identity', async () => {
  const orchestrator = new ConfiguredDataIntelligenceOrchestrator([{
    stage: 'EXTRACT',
    async execute() {
      return {
        stage: 'TRANSFORM',
        outputReference: 'object://tenant-1/transform',
      };
    },
  }]);

  await assert.rejects(
    () => orchestrator.execute({
      ...intent,
      stages: ['EXTRACT'],
    }),
    (error: unknown) =>
      error instanceof DataOrchestratorExecutionError
      && error.code === 'DATA_STAGE_OUTPUT_INVALID',
  );
});


test('rejects duplicate stage handlers at composition time', () => {
  const calls: string[] = [];
  assert.throws(
    () => new ConfiguredDataIntelligenceOrchestrator([
      handler('EXTRACT', calls),
      handler('EXTRACT', calls),
    ]),
    (error: unknown) =>
      error instanceof DataOrchestratorExecutionError
      && error.code === 'DATA_STAGE_HANDLER_DUPLICATE',
  );
});
