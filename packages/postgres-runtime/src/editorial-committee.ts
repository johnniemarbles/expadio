import type { EditorialCommitteeBrief } from '@expadio/agent-runtime';
import type { PostgresClient } from './index.ts';

const TASK_INPUT_REFERENCE_PATTERN = /^ref:task:([0-9a-f-]{36}):input$/iu;

export class EditorialBriefResolutionError extends Error {
  readonly code:
    | 'EDITORIAL_BRIEF_REFERENCE_INVALID'
    | 'EDITORIAL_BRIEF_TASK_NOT_FOUND'
    | 'EDITORIAL_BRIEF_INCOMPLETE';

  constructor(
    code:
      | 'EDITORIAL_BRIEF_REFERENCE_INVALID'
      | 'EDITORIAL_BRIEF_TASK_NOT_FOUND'
      | 'EDITORIAL_BRIEF_INCOMPLETE',
    message: string,
  ) {
    super(message);
    this.name = 'EditorialBriefResolutionError';
    this.code = code;
  }
}

/**
 * Resolves an editorial committee task's brief from the same task's own
 * action_payload, using the ref:task:<taskId>:input convention established
 * by GovernedTaskExecutor.executeTask(). The brief (verticalTheme,
 * brandVoiceGuideline, compliancePack) must have been set on the task's
 * actionPayload when the mission planned it.
 */
export class PostgresTaskActionPayloadBriefResolver {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolveBrief(inputReference: string, tenantId: string): Promise<EditorialCommitteeBrief> {
    const match = TASK_INPUT_REFERENCE_PATTERN.exec(inputReference);
    if (!match) {
      throw new EditorialBriefResolutionError(
        'EDITORIAL_BRIEF_REFERENCE_INVALID',
        `Cannot resolve an editorial brief from reference "${inputReference}".`,
      );
    }
    const taskId = match[1];

    const result = await this.#client.query<{ action_payload: Record<string, unknown> | null }>(
      `SELECT action_payload FROM platform.agent_tasks WHERE task_id = $1 AND tenant_id = $2`,
      [taskId, tenantId],
    );
    const payload = result.rows[0]?.action_payload;
    if (!payload) {
      throw new EditorialBriefResolutionError(
        'EDITORIAL_BRIEF_TASK_NOT_FOUND',
        `No task found for reference "${inputReference}".`,
      );
    }

    const verticalTheme = typeof payload.verticalTheme === 'string' ? payload.verticalTheme : null;
    const brandVoiceGuideline = typeof payload.brandVoiceGuideline === 'string' ? payload.brandVoiceGuideline : null;
    const compliancePack = typeof payload.compliancePack === 'string' ? payload.compliancePack : null;
    if (!verticalTheme || !brandVoiceGuideline || !compliancePack) {
      throw new EditorialBriefResolutionError(
        'EDITORIAL_BRIEF_INCOMPLETE',
        'Task action_payload is missing verticalTheme, brandVoiceGuideline, or compliancePack.',
      );
    }

    return { verticalTheme, brandVoiceGuideline, compliancePack };
  }
}
