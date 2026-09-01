import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const aiMigration = read('../../../infra/db/migrations/0098_ai_execution_runtime.sql');
const learningMigration = read('../../../infra/db/migrations/0099_learning_ai_requests.sql');
const executionArtifactMigration =
  read('../../../infra/db/migrations/0100_execution_artifacts.sql');
const runtime = read('../../../packages/postgres-runtime/src/learning-ai.ts');
const worker = read('../lib/ai-job-worker.ts');
const settings = read('../app/api/learning/ai/settings/route.ts');
const requests = read('../app/api/learning/ai/requests/route.ts');
const status = read('../app/api/learning/ai/requests/[id]/route.ts');
const workerRoute = read('../app/api/internal/ai-jobs/run/route.ts');

test('AI jobs remain reference-only while prompt/context and output use separate durable stores', () => {
  assert.match(aiMigration, /CREATE TABLE platform\.ai_job_artifacts/);
  assert.match(aiMigration, /CREATE TABLE platform\.ai_job_execution_queue/);
  assert.match(aiMigration, /AI job artifacts are immutable/);
  assert.match(aiMigration, /artifact_type IN \('INPUT','CONTEXT'\)/);
  assert.doesNotMatch(aiMigration, /artifact_type IN \('INPUT','CONTEXT','OUTPUT'\)/);
  assert.match(executionArtifactMigration, /CREATE TABLE platform\.execution_artifacts/);
  assert.match(executionArtifactMigration, /Execution artifacts are append-only/);
  assert.match(
    executionArtifactMigration,
    /ALTER TABLE platform\.execution_artifacts FORCE ROW LEVEL SECURITY/,
  );
  assert.match(
    aiMigration,
    /ALTER TABLE platform\.ai_job_artifacts FORCE ROW LEVEL SECURITY/,
  );
  assert.match(
    aiMigration,
    /ALTER TABLE platform\.ai_job_execution_queue FORCE ROW LEVEL SECURITY/,
  );

  assert.match(runtime, /aiArtifactReference\(inputArtifactId\)/);
  assert.match(runtime, /aiArtifactReference\(contextArtifactId\)/);
  assert.doesNotMatch(runtime, /inputReference:\s*promptText/);
});

test('Learning AI linkage is immutable tenant-scoped audit context', () => {
  assert.match(
    learningMigration,
    /CREATE TABLE platform\.learning_ai_requests/,
  );
  assert.match(
    learningMigration,
    /Learning AI request linkage is immutable/,
  );
  assert.match(
    learningMigration,
    /ALTER TABLE platform\.learning_ai_requests FORCE ROW LEVEL SECURITY/,
  );
  assert.match(learningMigration, /FOREIGN KEY \(job_id, tenant_id\)/);
  assert.match(learningMigration, /FOREIGN KEY \(input_artifact_id, tenant_id\)/);
});

test('Learning AI creation is feature gated and tutor access is learner-bound', () => {
  assert.match(runtime, /LEARNING_AI_FEATURES_DISABLED/);
  assert.match(runtime, /resolveCallerLearner/);
  assert.match(runtime, /subject_id = \$2/);
  assert.match(runtime, /status = 'ACTIVE'/);
  assert.match(runtime, /requestType === 'TUTOR'/);
  assert.match(runtime, /requestType === 'COACH'/);
});

test('historical AI results remain readable after the AI feature switch is disabled', () => {
  const statusStart = runtime.indexOf(
    'export async function loadLearningAiRequestStatus',
  );
  assert.ok(statusStart >= 0);
  const statusSource = runtime.slice(statusStart);
  assert.match(statusSource, /requireTenantModuleOperational/);
  assert.doesNotMatch(statusSource.slice(0, 600), /requireLearningAi/);
});

test('authoring and settings are admin-only while tutor request is authenticated tenant scoped', () => {
  assert.match(settings, /hasLearningAuthoringRole/);
  assert.match(settings, /resolveRequestContext/);
  assert.match(settings, /withTenantTransaction/);

  assert.match(requests, /resolveRequestContext/);
  assert.match(requests, /withTenantTransaction/);
  assert.match(requests, /AUTHOR_DRAFT/);
  assert.match(requests, /ASSESSMENT_FEEDBACK/);
  assert.match(requests, /hasLearningAuthoringRole/);

  assert.match(status, /loadLearningAiRequestStatus/);
  assert.match(status, /allowAdminRead/);
  assert.match(status, /resolveLearningAiOutput/);
});

test('AI execution stays horizontal and machine authenticated', () => {
  assert.match(workerRoute, /authenticateInternalWorkerRequest/);
  assert.match(workerRoute, /EXPADIO_AI_WORKER_SUBJECT_ID/);
  assert.match(workerRoute, /runAiJobWorkerOnce/);

  assert.match(worker, /PostgresProviderRegistryRepository/);
  assert.match(worker, /createGovernedCredentialLeaseRuntime/);
  assert.match(worker, /governedAiApiTokenProvider/);
  assert.match(worker, /OpenAiAiAdapter/);
  assert.match(worker, /GeminiAiAdapter/);
  assert.match(worker, /PostgresIntelligenceUsageRepository/);
});

test('AI worker writes provider output through governed durable storage before terminal success', () => {
  assert.match(worker, /createGovernedSupabaseArtifactStore/);
  assert.match(worker, /PostgresIndexedDurableArtifactSink/);
  assert.match(worker, /artifactKind: 'AI_TEXT'/);
  assert.match(worker, /sourceKind: 'AI_INVOCATION'/);
  assert.match(worker, /type: 'SUCCEEDED'/);
  assert.match(worker, /completeAiJobExecution/);
  assert.match(worker, /snapshot\.status === 'SUCCEEDED'/);
  assert.match(worker, /ALREADY_TERMINAL/);
  assert.doesNotMatch(worker, /artifactType: 'OUTPUT'/);
});

test('AI terminal replay reconciles deterministic usage from immutable output provenance', () => {
  assert.match(worker, /reconcileUsageFromOutputArtifact/);
  assert.match(worker, /eventId: input\.jobId/);
  assert.match(worker, /providerCostOwnership/);
  assert.match(worker, /snapshot\.outputReference\?\.startsWith\('supabase-storage:\/\/'\)/);
  assert.match(worker, /findExecutionArtifactBySource/);
});

test('durable worker fails closed for AI operation classes without durable text output', () => {
  assert.match(worker, /DURABLE_TEXT_OPERATIONS/);
  assert.match(worker, /AI_OPERATION_NOT_DURABLE_IN_WORKER/);
  assert.match(worker, /GENERATE/);
  assert.match(worker, /TRANSLATE/);
});

test('Learning runtime never imports provider adapters or credential repositories', () => {
  assert.doesNotMatch(runtime, /OpenAiAiAdapter|GeminiAiAdapter/);
  assert.doesNotMatch(
    runtime,
    /PostgresConnectorCredentialRepository|Vault|SecretResolver/,
  );
});
