import type { PoolClient } from 'pg';
import type {
  DomainEventConsumer,
  DomainEventConsumerContext,
} from '@expadio/postgres-runtime/domain-event-inbox-runner';
import type {
  CrmCaseActionPolicyEvaluator,
  CrmCaseGovernedActionResult,
} from './crm-case-governed-actions';
import {
  materializeCrmCaseGovernedActionsForEvent,
} from './crm-case-governed-actions';
import {
  executeGovernedCommunicateAction,
  type GovernedCommunicateExecutionResult,
} from './governed-communicate-executor';

export const GOVERNED_ACTIONS_DOMAIN_EVENT_CONSUMER_KEY = 'governed-actions';

export interface GovernedActionDomainEventConsumerResult {
  readonly ruleKey: string;
  readonly actionIntentId: string;
  readonly executorClass: string;
  readonly executionReference: string | null;
}

export interface GovernedActionDomainEventConsumerOptions {
  readonly policyEvaluator?: CrmCaseActionPolicyEvaluator;
  readonly now?: () => Date;
  readonly communicationNow?: () => string;
}

/**
 * Durable Domain Event consumer for the Governed Action Fabric.
 *
 * The inbox runner owns delivery/lease/retry state. This consumer owns only
 * business processing:
 *   event -> Pack rule -> materialized immutable Action Intent -> executor.
 *
 * Every downstream seam is idempotent, so replay after a process crash is safe:
 * Action Intents are deterministic by event/rule/executor and COMMUNICATE
 * execution replays its immutable queue attempt.
 */
export class GovernedActionDomainEventConsumer implements DomainEventConsumer {
  readonly #client: PoolClient;
  readonly #options: GovernedActionDomainEventConsumerOptions;

  constructor(
    client: PoolClient,
    options: GovernedActionDomainEventConsumerOptions = {},
  ) {
    this.#client = client;
    this.#options = options;
  }

  async consume(
    context: DomainEventConsumerContext,
  ): Promise<void> {
    const item = context.item;
    const results = await materializeCrmCaseGovernedActionsForEvent(
      this.#client,
      {
        tenantId: item.tenantId,
        eventId: item.eventId,
        ...(this.#options.policyEvaluator === undefined
          ? {}
          : { policyEvaluator: this.#options.policyEvaluator }),
        ...(this.#options.now === undefined
          ? {}
          : { now: this.#options.now }),
      },
    );

    for (const result of results) {
      await this.#executeMaterializedResult(result);
    }
  }

  async #executeMaterializedResult(
    result: CrmCaseGovernedActionResult,
  ): Promise<GovernedActionDomainEventConsumerResult> {
    if (result.status === 'SKIPPED') {
      throw new Error(
        `GOVERNED_ACTION_EVENT_CONSUMER_RULE_SKIPPED:${result.ruleKey}:${result.reasonCode}`,
      );
    }

    const intent = result.intent;
    if (intent.executorClass !== 'COMMUNICATE') {
      throw new Error(
        `GOVERNED_ACTION_EVENT_CONSUMER_EXECUTOR_UNAVAILABLE:${intent.executorClass}`,
      );
    }

    const execution: GovernedCommunicateExecutionResult =
      await executeGovernedCommunicateAction(this.#client, {
        intent,
        ...(this.#options.communicationNow === undefined
          ? {}
          : { now: this.#options.communicationNow }),
      });

    const executionReference = execution.attempt.outputReference;

    return {
      ruleKey: result.ruleKey,
      actionIntentId: intent.actionIntentId,
      executorClass: intent.executorClass,
      executionReference,
    };
  }
}
