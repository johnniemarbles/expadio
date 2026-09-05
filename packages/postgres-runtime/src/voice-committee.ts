import type { CallbackBrief } from '@expadio/agent-runtime';
import type { PostgresClient } from './index.ts';

const TASK_INPUT_REFERENCE_PATTERN = /^ref:task:([0-9a-f-]{36}):input$/iu;

export class VoiceCommitteeReferenceError extends Error {
  readonly code: 'VOICE_REFERENCE_INVALID' | 'VOICE_TASK_NOT_FOUND' | 'VOICE_BRIEF_INCOMPLETE';

  constructor(
    code: 'VOICE_REFERENCE_INVALID' | 'VOICE_TASK_NOT_FOUND' | 'VOICE_BRIEF_INCOMPLETE',
    message: string,
  ) {
    super(message);
    this.name = 'VoiceCommitteeReferenceError';
    this.code = code;
  }
}

/**
 * Resolves a callback-preparation task's brief from its own action_payload,
 * via the same ref:task:<id>:input convention GovernedTaskExecutor
 * establishes (see editorial-committee.ts's and revenue-committee.ts's
 * resolvers).
 */
export class PostgresCallbackBriefResolver {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolveBrief(inputReference: string, tenantId: string): Promise<CallbackBrief> {
    const match = TASK_INPUT_REFERENCE_PATTERN.exec(inputReference);
    if (!match) {
      throw new VoiceCommitteeReferenceError(
        'VOICE_REFERENCE_INVALID',
        `Cannot resolve a callback brief from reference "${inputReference}".`,
      );
    }
    const taskId = match[1];

    const result = await this.#client.query<{ action_payload: Record<string, unknown> | null }>(
      `SELECT action_payload FROM platform.agent_tasks WHERE task_id = $1 AND tenant_id = $2`,
      [taskId, tenantId],
    );
    const payload = result.rows[0]?.action_payload;
    if (!payload) {
      throw new VoiceCommitteeReferenceError(
        'VOICE_TASK_NOT_FOUND',
        `No task found for reference "${inputReference}".`,
      );
    }

    const leadName = typeof payload.leadName === 'string' ? payload.leadName : null;
    const callbackReason = typeof payload.callbackReason === 'string' ? payload.callbackReason : null;
    const brandVoiceGuideline = typeof payload.brandVoiceGuideline === 'string' ? payload.brandVoiceGuideline : null;
    const languageTag = typeof payload.languageTag === 'string' ? payload.languageTag : null;
    const jurisdictionTags = Array.isArray(payload.jurisdictionTags)
      ? payload.jurisdictionTags.filter((entry): entry is string => typeof entry === 'string')
      : [];

    if (!leadName || !callbackReason || !brandVoiceGuideline || !languageTag || jurisdictionTags.length === 0) {
      throw new VoiceCommitteeReferenceError(
        'VOICE_BRIEF_INCOMPLETE',
        'Task action_payload is missing leadName, callbackReason, brandVoiceGuideline, languageTag, or jurisdictionTags.',
      );
    }

    return { leadName, callbackReason, brandVoiceGuideline, languageTag, jurisdictionTags };
  }
}
