import type { PoolClient } from 'pg';
import type {
  GovernedActionPolicyDecision,
  GovernedActionRule,
} from '@expadio/governed-actions';
import {
  materializeGovernedActionRule,
  resolveGovernedAction,
} from '@expadio/governed-actions';
import { loadDomainEvent } from '@expadio/postgres-runtime/domain-events';
import {
  listEnabledLearningAutomationRulesForEvent,
} from '@expadio/postgres-runtime/learning-automation';
import {
  persistGovernedActionIntent,
  type PersistedGovernedActionIntent,
} from '@expadio/postgres-runtime/governed-action-intent';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LearnerContextRow {
  readonly learner_id: string;
  readonly subject_id: string | null;
  readonly subject_issuer: string | null;
  readonly full_name: string;
  readonly email: string | null;
  readonly audience_type: string;
  readonly status: string;
}

export interface LearningActionAggregateContext {
  readonly [key: string]: unknown;
  readonly learnerId: string | null;
  readonly learnerSubjectId: string | null;
  readonly learnerSubjectIssuer: string | null;
  readonly learnerName: string | null;
  readonly learnerEmail: string | null;
  readonly learnerAudienceType: string | null;
  readonly learnerStatus: string | null;
}

export interface LearningActionPolicyEvaluator {
  evaluate(input: {
    readonly rule: GovernedActionRule;
    readonly eventId: string;
    readonly tenantId: string;
    readonly aggregate: LearningActionAggregateContext;
    readonly evaluatedAt: Date;
  }): Promise<GovernedActionPolicyDecision>;
}

export type LearningGovernedActionResult =
  | {
      readonly status: 'PERSISTED';
      readonly ruleKey: string;
      readonly intent: PersistedGovernedActionIntent;
    }
  | {
      readonly status: 'SKIPPED';
      readonly ruleKey: string;
      readonly reasonCode: string;
      readonly reason: string;
    };

async function loadLearningActionAggregateContext(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly learnerId: unknown;
  },
): Promise<LearningActionAggregateContext> {
  if (
    typeof input.learnerId !== 'string'
    || !UUID.test(input.learnerId.trim())
  ) {
    return {
      learnerId: null,
      learnerSubjectId: null,
      learnerSubjectIssuer: null,
      learnerName: null,
      learnerEmail: null,
      learnerAudienceType: null,
      learnerStatus: null,
    };
  }

  const learnerId = input.learnerId.trim();
  const result = await client.query<LearnerContextRow>(
    `SELECT learner_id, subject_id, subject_issuer, full_name,
            email, audience_type, status
       FROM platform.learning_learners
      WHERE tenant_id = $1::uuid
        AND learner_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, learnerId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return {
      learnerId,
      learnerSubjectId: null,
      learnerSubjectIssuer: null,
      learnerName: null,
      learnerEmail: null,
      learnerAudienceType: null,
      learnerStatus: null,
    };
  }

  return {
    learnerId: row.learner_id,
    learnerSubjectId: row.subject_id,
    learnerSubjectIssuer: row.subject_issuer,
    learnerName: row.full_name,
    learnerEmail: row.email,
    learnerAudienceType: row.audience_type,
    learnerStatus: row.status,
  };
}

/**
 * Resolve tenant-configured Learning rules for one already-persisted Domain
 * Event and persist allowed actions into the shared Governed Action Intent
 * store. No Learning-specific executor exists here.
 *
 * Learner PII is loaded only at event-processing time and is available to
 * aggregate bindings. Persisted rule configuration contains binding
 * instructions rather than concrete learner values.
 */
export async function materializeLearningGovernedActionsForEvent(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly eventId: string;
    readonly policyEvaluator?: LearningActionPolicyEvaluator;
    readonly now?: () => Date;
  },
): Promise<readonly LearningGovernedActionResult[]> {
  const event = await loadDomainEvent(client, {
    tenantId: input.tenantId,
    eventId: input.eventId,
  });
  if (event === null) throw new Error('LEARNING_ACTION_EVENT_NOT_FOUND');
  if (!event.aggregateType.startsWith('learning.')) {
    throw new Error('LEARNING_ACTION_AGGREGATE_TYPE_INVALID');
  }

  const rules = await listEnabledLearningAutomationRulesForEvent(client, {
    tenantId: input.tenantId,
    eventType: event.eventType,
  });
  if (rules.length === 0) return [];

  const aggregate = await loadLearningActionAggregateContext(client, {
    tenantId: input.tenantId,
    learnerId: event.payload.learnerId,
  });

  const evaluatedAt = input.now?.() ?? new Date();
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new Error('LEARNING_ACTION_CLOCK_INVALID');
  }

  const results: LearningGovernedActionResult[] = [];
  for (const rule of rules) {
    let materializedRule: GovernedActionRule;
    try {
      materializedRule = materializeGovernedActionRule(rule, {
        event,
        aggregateFields: aggregate,
      });
    } catch (error) {
      results.push({
        status: 'SKIPPED',
        ruleKey: rule.ruleKey,
        reasonCode: 'BINDING_FAILED',
        reason:
          error instanceof Error
            ? error.message
            : 'Learning action binding failed.',
      });
      continue;
    }

    let decision: GovernedActionPolicyDecision;
    if (materializedRule.policyKeys.length === 0) {
      decision = {
        allowed: true,
        policyKeys: [],
        evidenceRefs: [
          'binding:materialized',
          `aggregate:${event.aggregateType}:${event.aggregateId}`,
          ...(aggregate.learnerId === null
            ? []
            : [`learning.learner:${aggregate.learnerId}`]),
        ],
        reasonCode: 'NO_ADDITIONAL_POLICY_REQUIRED',
        evaluatedAt,
      };
    } else if (input.policyEvaluator === undefined) {
      results.push({
        status: 'SKIPPED',
        ruleKey: materializedRule.ruleKey,
        reasonCode: 'POLICY_EVALUATOR_REQUIRED',
        reason:
          'This Learning automation rule declares policy keys but no evaluator was supplied.',
      });
      continue;
    } else {
      decision = await input.policyEvaluator.evaluate({
        rule: materializedRule,
        eventId: event.eventId,
        tenantId: event.tenantId,
        aggregate,
        evaluatedAt,
      });
    }

    const resolved = resolveGovernedAction(event, materializedRule, decision);
    if (!resolved.matched) {
      results.push({
        status: 'SKIPPED',
        ruleKey: materializedRule.ruleKey,
        reasonCode: resolved.reason,
        reason: 'The Learning automation rule no longer matches this event.',
      });
      continue;
    }
    if (!resolved.allowed) {
      results.push({
        status: 'SKIPPED',
        ruleKey: materializedRule.ruleKey,
        reasonCode: resolved.reasonCode,
        reason: 'Governed action policy refused this Learning action.',
      });
      continue;
    }

    results.push({
      status: 'PERSISTED',
      ruleKey: materializedRule.ruleKey,
      intent: await persistGovernedActionIntent(client, resolved.intent),
    });
  }

  return results;
}
