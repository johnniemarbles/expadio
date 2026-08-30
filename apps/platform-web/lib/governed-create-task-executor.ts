import type { PoolClient } from 'pg';
import {
  governedActionExecutionAttemptKey,
  type PersistedGovernedActionExecutionAttempt,
} from '@expadio/governed-actions';
import {
  findGovernedActionExecutionAttempt,
  persistGovernedActionExecutionAttempt,
} from '@expadio/postgres-runtime/governed-action-execution';
import type { PersistedGovernedActionIntent } from '@expadio/postgres-runtime/governed-action-intent';
import {
  createOperationalTaskForGovernedAction,
  type OperationalTaskPriority,
  type PersistedOperationalTask,
} from '@expadio/postgres-runtime/operational-task';

interface CreateTaskConfiguration {
  readonly title: string;
  readonly description: string | null;
  readonly assigneeSubjectId: string | null;
  readonly dueAt: Date | null;
  readonly priority: OperationalTaskPriority;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`CREATE_TASK_${field.toUpperCase()}_INVALID`);
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function parseCreateTaskConfiguration(
  configuration: Readonly<Record<string, unknown>>,
): CreateTaskConfiguration {
  const title = configuration.title;
  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error('CREATE_TASK_TITLE_REQUIRED');
  }

  const priorityValue = configuration.priority ?? 'NORMAL';
  if (
    priorityValue !== 'LOW'
    && priorityValue !== 'NORMAL'
    && priorityValue !== 'HIGH'
    && priorityValue !== 'URGENT'
  ) {
    throw new Error('CREATE_TASK_PRIORITY_INVALID');
  }

  const dueAtValue = optionalString(configuration.dueAt, 'due_at');
  let dueAt: Date | null = null;
  if (dueAtValue !== null) {
    dueAt = new Date(dueAtValue);
    if (Number.isNaN(dueAt.getTime())) throw new Error('CREATE_TASK_DUE_AT_INVALID');
  }

  return {
    title: title.trim(),
    description: optionalString(configuration.description, 'description'),
    assigneeSubjectId: optionalString(configuration.assigneeSubjectId, 'assignee_subject_id'),
    dueAt,
    priority: priorityValue,
  };
}

export interface GovernedCreateTaskExecutionResult {
  readonly replayed: boolean;
  readonly attempt: PersistedGovernedActionExecutionAttempt;
  readonly task: PersistedOperationalTask | null;
}

export async function executeGovernedCreateTaskAction(
  client: PoolClient,
  input: {
    readonly intent: PersistedGovernedActionIntent;
    readonly now?: () => Date;
  },
): Promise<GovernedCreateTaskExecutionResult> {
  const now = input.now?.() ?? new Date();
  const attemptKey = governedActionExecutionAttemptKey({
    actionIntentId: input.intent.actionIntentId,
    phase: 'task.create',
  });

  const existing = await findGovernedActionExecutionAttempt(client, {
    tenantId: input.intent.tenantId,
    actionIntentId: input.intent.actionIntentId,
    attemptKey,
  });
  if (existing !== null) {
    return { replayed: true, attempt: existing, task: null };
  }

  if (input.intent.executorClass !== 'CREATE_TASK') {
    const attempt = await persistGovernedActionExecutionAttempt(client, {
      tenantId: input.intent.tenantId,
      actionIntentId: input.intent.actionIntentId,
      executorClass: 'CREATE_TASK',
      attemptKey,
      status: 'REFUSED',
      startedAt: now,
      completedAt: now,
      reasonCode: 'WRONG_EXECUTOR_CLASS',
      reason: 'This runtime only executes CREATE_TASK Action Intents.',
      outputReference: null,
      metadata: { suppliedExecutorClass: input.intent.executorClass },
    });
    return { replayed: false, attempt, task: null };
  }

  let parsed: CreateTaskConfiguration;
  try {
    parsed = parseCreateTaskConfiguration(input.intent.configuration);
  } catch (error) {
    const attempt = await persistGovernedActionExecutionAttempt(client, {
      tenantId: input.intent.tenantId,
      actionIntentId: input.intent.actionIntentId,
      executorClass: 'CREATE_TASK',
      attemptKey,
      status: 'REFUSED',
      startedAt: now,
      completedAt: now,
      reasonCode: 'CONFIGURATION_INVALID',
      reason: error instanceof Error ? error.message : 'Task configuration is invalid.',
      outputReference: null,
      metadata: {},
    });
    return { replayed: false, attempt, task: null };
  }

  const created = await createOperationalTaskForGovernedAction(client, {
    intent: input.intent,
    title: parsed.title,
    description: parsed.description,
    assigneeSubjectId: parsed.assigneeSubjectId,
    dueAt: parsed.dueAt,
    priority: parsed.priority,
  });

  const attempt = await persistGovernedActionExecutionAttempt(client, {
    tenantId: input.intent.tenantId,
    actionIntentId: input.intent.actionIntentId,
    executorClass: 'CREATE_TASK',
    attemptKey,
    status: 'SUCCEEDED',
    startedAt: now,
    completedAt: now,
    reasonCode: created.replayed ? 'TASK_ALREADY_EXISTS' : 'TASK_CREATED',
    reason: null,
    outputReference: `operational.task:${created.task.taskId}`,
    metadata: {
      taskId: created.task.taskId,
      assigneeSubjectId: created.task.assigneeSubjectId,
      dueAt: created.task.dueAt?.toISOString() ?? null,
      priority: created.task.priority,
    },
  });

  return {
    replayed: created.replayed,
    attempt,
    task: created.task,
  };
}
