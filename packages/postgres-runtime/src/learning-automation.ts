import { randomUUID } from 'node:crypto';
import {
  validateLearningAutomationRuleDraft,
  validateLearningAutomationRuleKey,
  type LearningAutomationExecutorClass,
} from '@expadio/learning';
import type { GovernedActionRule } from '@expadio/governed-actions';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import {
  loadTenantProductModule,
  requireTenantModuleOperational,
} from './product-module.ts';

interface RuleRow {
  readonly automation_rule_id: string;
  readonly rule_key: string;
  readonly event_type: string;
  readonly executor_class: LearningAutomationExecutorClass;
  readonly action_key: string;
  readonly enabled: boolean;
  readonly policy_keys: readonly string[];
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly revision: number;
  readonly created_by_subject_id: string;
  readonly updated_by_subject_id: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

export interface LearningAutomationRuleSummary {
  readonly automationRuleId: string;
  readonly ruleKey: string;
  readonly eventType: string;
  readonly executorClass: LearningAutomationExecutorClass;
  readonly actionKey: string;
  readonly enabled: boolean;
  readonly policyKeys: readonly string[];
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly revision: number;
  readonly createdBySubjectId: string;
  readonly updatedBySubjectId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRule(row: RuleRow): LearningAutomationRuleSummary {
  return {
    automationRuleId: row.automation_rule_id,
    ruleKey: row.rule_key,
    eventType: row.event_type,
    executorClass: row.executor_class,
    actionKey: row.action_key,
    enabled: row.enabled,
    policyKeys: [...row.policy_keys],
    configuration: row.configuration,
    revision: row.revision,
    createdBySubjectId: row.created_by_subject_id,
    updatedBySubjectId: row.updated_by_subject_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const SELECT_COLUMNS = `
  automation_rule_id, rule_key, event_type, executor_class, action_key,
  enabled, policy_keys, configuration, revision, created_by_subject_id,
  updated_by_subject_id, created_at, updated_at
`;

export async function listLearningAutomationRules(
  client: PostgresClient,
  tenantId: string,
): Promise<readonly LearningAutomationRuleSummary[]> {
  await requireTenantModuleOperational(client, {
    tenantId,
    moduleKey: 'learning',
  });
  const result = await client.query<RuleRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM platform.learning_automation_rules
      WHERE tenant_id = $1::uuid
      ORDER BY rule_key`,
    [tenantId],
  );
  return result.rows.map(mapRule);
}

export async function createLearningAutomationRule(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly ruleKey: unknown;
    readonly rule: unknown;
  },
): Promise<LearningAutomationRuleSummary> {
  await requireTenantModuleOperational(client, {
    tenantId: input.tenantId,
    moduleKey: 'learning',
  });

  const ruleKey = validateLearningAutomationRuleKey(input.ruleKey);
  const rule = validateLearningAutomationRuleDraft(input.rule);

  try {
    const inserted = await client.query<RuleRow>(
      `INSERT INTO platform.learning_automation_rules (
         tenant_id, rule_key, event_type, executor_class, action_key,
         enabled, policy_keys, configuration, created_by_subject_id,
         updated_by_subject_id
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $9
       )
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenantId,
        ruleKey,
        rule.eventType,
        rule.executorClass,
        rule.actionKey,
        rule.enabled,
        JSON.stringify(rule.policyKeys),
        JSON.stringify(rule.configuration),
        input.actorSubjectId,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('LEARNING_AUTOMATION_RULE_INSERT_FAILED');
    const created = mapRule(row);

    await appendDomainEventWithOutbox(client, {
      event: {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateType: 'learning.automation_rule',
        aggregateId: created.automationRuleId,
        eventType: 'learning.automation.rule.created',
        eventVersion: 1,
        occurredAt: new Date(),
        actorSubjectId: input.actorSubjectId,
        correlationId: input.correlationId,
        payload: {
          automationRuleId: created.automationRuleId,
          ruleKey: created.ruleKey,
          matchedEventType: created.eventType,
          executorClass: created.executorClass,
          actionKey: created.actionKey,
          enabled: created.enabled,
          revision: created.revision,
        },
        metadata: { source: 'learning.automation.authoring' },
      },
    });

    return created;
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new Error('LEARNING_AUTOMATION_RULE_KEY_EXISTS');
    }
    throw error;
  }
}

export async function updateLearningAutomationRule(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly automationRuleId: string;
    readonly expectedRevision: number;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly rule: unknown;
  },
): Promise<LearningAutomationRuleSummary> {
  await requireTenantModuleOperational(client, {
    tenantId: input.tenantId,
    moduleKey: 'learning',
  });
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision <= 0) {
    throw new Error('LEARNING_AUTOMATION_RULE_REVISION_INVALID');
  }
  const rule = validateLearningAutomationRuleDraft(input.rule);

  const current = await client.query<RuleRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM platform.learning_automation_rules
      WHERE tenant_id = $1::uuid
        AND automation_rule_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, input.automationRuleId],
  );
  const existing = current.rows[0];
  if (existing === undefined) throw new Error('LEARNING_AUTOMATION_RULE_NOT_FOUND');
  if (existing.revision !== input.expectedRevision) {
    throw new Error('LEARNING_AUTOMATION_RULE_REVISION_CONFLICT');
  }

  const updated = await client.query<RuleRow>(
    `UPDATE platform.learning_automation_rules
        SET event_type = $3,
            executor_class = $4,
            action_key = $5,
            enabled = $6,
            policy_keys = $7::jsonb,
            configuration = $8::jsonb,
            revision = revision + 1,
            updated_by_subject_id = $9
      WHERE tenant_id = $1::uuid
        AND automation_rule_id = $2::uuid
        AND revision = $10
      RETURNING ${SELECT_COLUMNS}`,
    [
      input.tenantId,
      input.automationRuleId,
      rule.eventType,
      rule.executorClass,
      rule.actionKey,
      rule.enabled,
      JSON.stringify(rule.policyKeys),
      JSON.stringify(rule.configuration),
      input.actorSubjectId,
      input.expectedRevision,
    ],
  );
  const row = updated.rows[0];
  if (row === undefined) throw new Error('LEARNING_AUTOMATION_RULE_REVISION_CONFLICT');
  const value = mapRule(row);

  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'learning.automation_rule',
      aggregateId: value.automationRuleId,
      eventType: 'learning.automation.rule.updated',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: {
        automationRuleId: value.automationRuleId,
        ruleKey: value.ruleKey,
        matchedEventType: value.eventType,
        executorClass: value.executorClass,
        actionKey: value.actionKey,
        enabled: value.enabled,
        revision: value.revision,
      },
      metadata: { source: 'learning.automation.authoring' },
    },
  });

  return value;
}

/**
 * Runtime lookup used by the shared Domain Event action worker.
 *
 * A suspended/not-entitled Learning module produces no rules. This consumes old
 * outbox items safely without executing module side effects or creating an
 * infinite retry loop during a commercial suspension.
 */
export async function listEnabledLearningAutomationRulesForEvent(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly eventType: string;
  },
): Promise<readonly GovernedActionRule[]> {
  const module = await loadTenantProductModule(client, {
    tenantId: input.tenantId,
    moduleKey: 'learning',
  });
  if (module === null || module.availability !== 'ACTIVE') return [];

  const result = await client.query<RuleRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM platform.learning_automation_rules
      WHERE tenant_id = $1::uuid
        AND event_type = $2
        AND enabled = true
      ORDER BY rule_key`,
    [input.tenantId, input.eventType],
  );

  return result.rows.map((row) => ({
    ruleKey: row.rule_key,
    eventType: row.event_type,
    executorClass: row.executor_class,
    actionKey: row.action_key,
    enabled: row.enabled,
    policyKeys: [...row.policy_keys],
    configuration: row.configuration,
  }));
}
