import type { LeadDossier, OutreachBrief } from '@expadio/agent-runtime';
import type { PostgresClient } from './index.ts';
import { getAgentTenantMemory } from './agent-tenant-memory.ts';

const TASK_INPUT_REFERENCE_PATTERN = /^ref:task:([0-9a-f-]{36}):input$/iu;

export class RevenueCommitteeReferenceError extends Error {
  readonly code: 'REVENUE_REFERENCE_INVALID' | 'REVENUE_TASK_NOT_FOUND' | 'REVENUE_BRIEF_INCOMPLETE';

  constructor(
    code: 'REVENUE_REFERENCE_INVALID' | 'REVENUE_TASK_NOT_FOUND' | 'REVENUE_BRIEF_INCOMPLETE',
    message: string,
  ) {
    super(message);
    this.name = 'RevenueCommitteeReferenceError';
    this.code = code;
  }
}

async function loadTaskActionPayload(
  client: PostgresClient,
  inputReference: string,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const match = TASK_INPUT_REFERENCE_PATTERN.exec(inputReference);
  if (!match) {
    throw new RevenueCommitteeReferenceError(
      'REVENUE_REFERENCE_INVALID',
      `Cannot resolve a task from reference "${inputReference}".`,
    );
  }
  const taskId = match[1];
  const result = await client.query<{ action_payload: Record<string, unknown> | null }>(
    `SELECT action_payload FROM platform.agent_tasks WHERE task_id = $1 AND tenant_id = $2`,
    [taskId, tenantId],
  );
  const payload = result.rows[0]?.action_payload;
  if (!payload) {
    throw new RevenueCommitteeReferenceError(
      'REVENUE_TASK_NOT_FOUND',
      `No task found for reference "${inputReference}".`,
    );
  }
  return payload;
}

/**
 * Resolves a lead-osint task's research target (a company domain or name)
 * from its own action_payload, via the same ref:task:<id>:input convention
 * GovernedTaskExecutor establishes (see editorial-committee.ts's resolver).
 */
export class PostgresLeadTargetResolver {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolveTarget(inputReference: string, tenantId: string): Promise<string> {
    const payload = await loadTaskActionPayload(this.#client, inputReference, tenantId);
    const target = typeof payload.leadTarget === 'string' ? payload.leadTarget : null;
    if (!target) {
      throw new RevenueCommitteeReferenceError(
        'REVENUE_BRIEF_INCOMPLETE',
        'Task action_payload is missing leadTarget.',
      );
    }
    return target;
  }
}

/**
 * Reads back a LeadDossier previously saved via the generic
 * PostgresAgentArtifactStore (agent-tenant-memory.ts) -- both the lead-osint
 * tool's save and the outreach-draft tool's read go through
 * platform.agent_tenant_memory, so no separate save method is needed here.
 */
export class PostgresLeadDossierReader {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async getDossier(tenantId: string, key: string): Promise<LeadDossier | null> {
    const record = await getAgentTenantMemory(this.#client, tenantId, key);
    return (record?.memoryValue as LeadDossier | undefined) ?? null;
  }
}

/**
 * Resolves an outreach-draft task's brief (leadName, dossierKey,
 * brandVoiceGuideline, caseStudyReferences) from its own action_payload.
 */
export class PostgresOutreachBriefResolver {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolveBrief(inputReference: string, tenantId: string): Promise<OutreachBrief> {
    const payload = await loadTaskActionPayload(this.#client, inputReference, tenantId);

    const leadName = typeof payload.leadName === 'string' ? payload.leadName : null;
    const dossierKey = typeof payload.dossierKey === 'string' ? payload.dossierKey : null;
    const brandVoiceGuideline = typeof payload.brandVoiceGuideline === 'string' ? payload.brandVoiceGuideline : null;
    const caseStudyReferences = Array.isArray(payload.caseStudyReferences)
      ? payload.caseStudyReferences.filter((entry): entry is string => typeof entry === 'string')
      : [];

    if (!leadName || !dossierKey || !brandVoiceGuideline) {
      throw new RevenueCommitteeReferenceError(
        'REVENUE_BRIEF_INCOMPLETE',
        'Task action_payload is missing leadName, dossierKey, or brandVoiceGuideline.',
      );
    }

    return { leadName, dossierKey, brandVoiceGuideline, caseStudyReferences };
  }
}
