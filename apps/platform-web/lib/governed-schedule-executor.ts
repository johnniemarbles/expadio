import type { PoolClient } from 'pg';
import {
  governedActionExecutionAttemptKey,
  type GovernedActionExecutorClass,
  type PersistedGovernedActionExecutionAttempt,
} from '@expadio/governed-actions';
import { loadDomainEvent } from '@expadio/postgres-runtime/domain-events';
import {
  findGovernedActionExecutionAttempt,
  persistGovernedActionExecutionAttempt,
} from '@expadio/postgres-runtime/governed-action-execution';
import type { PersistedGovernedActionIntent } from '@expadio/postgres-runtime/governed-action-intent';
import {
  persistScheduledGovernedAction,
  type PersistedScheduledGovernedAction,
} from '@expadio/postgres-runtime/scheduled-governed-action';

interface ScheduledTargetConfiguration {
  readonly executorClass: Exclude<GovernedActionExecutorClass, 'SCHEDULE'>;
  readonly actionKey: string;
  readonly configuration: Readonly<Record<string, unknown>>;
}

function parseScheduleConfiguration(
  configuration: Readonly<Record<string, unknown>>,
): { readonly delaySeconds: number; readonly target: ScheduledTargetConfiguration } {
  const delaySeconds = configuration.delaySeconds;
  const target = configuration.target;
  if (
    typeof delaySeconds !== 'number'
    || !Number.isFinite(delaySeconds)
    || delaySeconds < 0
    || typeof target !== 'object'
    || target === null
    || Array.isArray(target)
  ) {
    throw new Error('GOVERNED_SCHEDULE_CONFIGURATION_INVALID');
  }
  const candidate = target as {
    readonly executorClass?: unknown;
    readonly actionKey?: unknown;
    readonly configuration?: unknown;
  };
  if (
    typeof candidate.executorClass !== 'string'
    || candidate.executorClass === 'SCHEDULE'
    || typeof candidate.actionKey !== 'string'
    || candidate.actionKey.trim() === ''
    || typeof candidate.configuration !== 'object'
    || candidate.configuration === null
    || Array.isArray(candidate.configuration)
  ) {
    throw new Error('GOVERNED_SCHEDULE_TARGET_INVALID');
  }

  return {
    delaySeconds,
    target: {
      executorClass: candidate.executorClass as Exclude<GovernedActionExecutorClass, 'SCHEDULE'>,
      actionKey: candidate.actionKey.trim(),
      configuration: candidate.configuration as Readonly<Record<string, unknown>>,
    },
  };
}

export interface GovernedScheduleExecutionResult {
  readonly replayed: boolean;
  readonly attempt: PersistedGovernedActionExecutionAttempt;
  readonly scheduled: PersistedScheduledGovernedAction | null;
}

export async function executeGovernedScheduleAction(
  client: PoolClient,
  input: { readonly intent: PersistedGovernedActionIntent; readonly now?: () => Date },
): Promise<GovernedScheduleExecutionResult> {
  const now = input.now?.() ?? new Date();
  const attemptKey = governedActionExecutionAttemptKey({
    actionIntentId: input.intent.actionIntentId,
    phase: 'schedule.enqueue',
  });

  const existing = await findGovernedActionExecutionAttempt(client, {
    tenantId: input.intent.tenantId,
    actionIntentId: input.intent.actionIntentId,
    attemptKey,
  });
  if (existing !== null) return { replayed: true, attempt: existing, scheduled: null };

  if (input.intent.executorClass !== 'SCHEDULE') {
    const attempt = await persistGovernedActionExecutionAttempt(client, {
      tenantId: input.intent.tenantId,
      actionIntentId: input.intent.actionIntentId,
      executorClass: 'SCHEDULE',
      attemptKey,
      status: 'REFUSED',
      startedAt: now,
      completedAt: now,
      reasonCode: 'WRONG_EXECUTOR_CLASS',
      reason: 'This runtime only executes SCHEDULE Action Intents.',
      outputReference: null,
      metadata: { suppliedExecutorClass: input.intent.executorClass },
    });
    return { replayed: false, attempt, scheduled: null };
  }

  let parsed: ReturnType<typeof parseScheduleConfiguration>;
  try {
    parsed = parseScheduleConfiguration(input.intent.configuration);
  } catch (error) {
    const attempt = await persistGovernedActionExecutionAttempt(client, {
      tenantId: input.intent.tenantId,
      actionIntentId: input.intent.actionIntentId,
      executorClass: 'SCHEDULE',
      attemptKey,
      status: 'REFUSED',
      startedAt: now,
      completedAt: now,
      reasonCode: 'CONFIGURATION_INVALID',
      reason: error instanceof Error ? error.message : 'Schedule configuration is invalid.',
      outputReference: null,
      metadata: {},
    });
    return { replayed: false, attempt, scheduled: null };
  }

  const sourceEvent = await loadDomainEvent(client, {
    tenantId: input.intent.tenantId,
    eventId: input.intent.sourceEventId,
  });
  if (sourceEvent === null) {
    throw new Error('GOVERNED_SCHEDULE_SOURCE_EVENT_NOT_FOUND');
  }
  const dueAt = new Date(sourceEvent.occurredAt.getTime() + parsed.delaySeconds * 1000);
  const scheduled = await persistScheduledGovernedAction(client, {
    parentIntent: input.intent,
    dueAt,
    targetExecutorClass: parsed.target.executorClass,
    targetActionKey: parsed.target.actionKey,
    targetConfiguration: parsed.target.configuration,
  });

  const attempt = await persistGovernedActionExecutionAttempt(client, {
    tenantId: input.intent.tenantId,
    actionIntentId: input.intent.actionIntentId,
    executorClass: 'SCHEDULE',
    attemptKey,
    status: 'QUEUED',
    startedAt: now,
    completedAt: now,
    reasonCode: 'ACTION_SCHEDULED',
    reason: null,
    outputReference: `scheduled.action:${scheduled.scheduledActionId}`,
    metadata: {
      dueAt: scheduled.dueAt.toISOString(),
      targetExecutorClass: scheduled.targetExecutorClass,
      targetActionKey: scheduled.targetActionKey,
    },
  });

  return { replayed: false, attempt, scheduled };
}
