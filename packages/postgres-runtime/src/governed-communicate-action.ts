import type { CommunicationDispatchPort } from '@expadio/communication/dispatch';
import {
  executeCommunicateActionIntent,
  type CommunicateActionExecutionResult,
} from '@expadio/governed-actions';
import type {
  PersistedGovernedActionIntent,
} from './governed-action-intent.ts';
import {
  beginGovernedActionExecutionAttempt,
  completeGovernedActionExecutionAttempt,
  type GovernedActionExecutionAttempt,
} from './governed-action-execution-attempt.ts';
import { PostgresCommunicationConsentRepository } from './consent.ts';
import { PostgresCommunicationSuppressionRepository } from './suppression.ts';
import { PostgresCommunicationTemplateRepository } from './template.ts';
import type { PostgresClient } from './index.ts';

export interface ExecutePersistedCommunicateActionResult {
  readonly attempt: GovernedActionExecutionAttempt;
  readonly execution: CommunicateActionExecutionResult;
}

/**
 * PostgreSQL-backed COMMUNICATE executor runtime.
 *
 * The immutable Action Intent is read-only input. Operational retry state is
 * recorded in governed_action_execution_attempts. The supplied dispatch port is
 * the existing Communications provider-neutral queued boundary.
 */
export async function executePersistedCommunicateAction(
  client: PostgresClient,
  input: {
    readonly actionIntent: PersistedGovernedActionIntent;
    readonly dispatch: CommunicationDispatchPort;
  },
): Promise<ExecutePersistedCommunicateActionResult> {
  const intent = input.actionIntent;
  if (intent.executorClass !== 'COMMUNICATE') {
    throw new Error('GOVERNED_ACTION_EXECUTOR_CLASS_MISMATCH');
  }

  const started = await beginGovernedActionExecutionAttempt(client, {
    tenantId: intent.tenantId,
    actionIntentId: intent.actionIntentId,
    executorClass: intent.executorClass,
  });

  try {
    const execution = await executeCommunicateActionIntent(intent, {
      compliance: {
        consent: new PostgresCommunicationConsentRepository(client),
        suppression: new PostgresCommunicationSuppressionRepository(client),
      },
      templates: new PostgresCommunicationTemplateRepository(client),
      dispatch: input.dispatch,
    });

    const refused =
      !execution.executed
      || execution.dispatch.state === 'REFUSED';

    const reasonCode = execution.executed
      ? execution.dispatch.reasonCode
      : execution.reasonCode;

    const result = execution.executed
      ? {
          communicationState: execution.dispatch.state,
          communicationReasonCode: execution.dispatch.reasonCode,
          messageId: execution.dispatch.messageId,
          ...(execution.dispatch.providerKey === undefined
            ? {}
            : { providerKey: execution.dispatch.providerKey }),
          ...(execution.dispatch.queuedAt === undefined
            ? {}
            : { queuedAt: execution.dispatch.queuedAt }),
        }
      : {
          communicationState: 'REFUSED',
          communicationReasonCode: execution.reasonCode,
          reason: execution.reason,
        };

    const completed = await completeGovernedActionExecutionAttempt(client, {
      tenantId: intent.tenantId,
      executionAttemptId: started.executionAttemptId,
      state: refused ? 'REFUSED' : 'SUCCEEDED',
      reasonCode,
      result,
    });

    return {
      attempt: completed,
      execution,
    };
  } catch (error) {
    await completeGovernedActionExecutionAttempt(client, {
      tenantId: intent.tenantId,
      executionAttemptId: started.executionAttemptId,
      state: 'FAILED',
      reasonCode: 'EXECUTOR_EXCEPTION',
      result: {
        error: error instanceof Error ? error.message : 'Unknown executor failure',
      },
    });
    throw error;
  }
}
