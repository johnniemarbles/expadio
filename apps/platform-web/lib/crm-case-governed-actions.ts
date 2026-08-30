import type { PoolClient } from 'pg';
import type {
  GovernedActionPolicyDecision,
  GovernedActionRule,
} from '@expadio/governed-actions';
import {
  materializeGovernedActionRule,
  resolveGovernedAction,
} from '@expadio/governed-actions';
import {
  resolveGovernedActionRules,
} from '@expadio/industry-packs';
import {
  loadDomainEvent,
} from '@expadio/postgres-runtime/domain-events';
import {
  persistGovernedActionIntent,
  type PersistedGovernedActionIntent,
} from '@expadio/postgres-runtime/governed-action-intent';
import {
  loadPinnedCrmCaseIndustryPack,
  type CrmCaseIndustryPackProvenance,
} from './crm-case-lifecycle-event';

interface CrmCaseActionContextRow {
  readonly case_id: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: string;
  readonly stage_key: string | null;
  readonly owner_subject_id: string | null;
  readonly contact_id: string | null;
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly account_id: string | null;
  readonly account_name: string | null;
}

export interface CrmCaseActionAggregateContext {
  readonly [key: string]: unknown;
  readonly caseId: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: string;
  readonly stageKey: string | null;
  readonly ownerSubjectId: string | null;
  readonly contactId: string | null;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly accountId: string | null;
  readonly accountName: string | null;
}

export interface CrmCaseActionPolicyEvaluator {
  evaluate(input: {
    readonly rule: GovernedActionRule;
    readonly eventId: string;
    readonly tenantId: string;
    readonly aggregate: CrmCaseActionAggregateContext;
    readonly evaluatedAt: Date;
  }): Promise<GovernedActionPolicyDecision>;
}

export type CrmCaseGovernedActionResult =
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

export async function loadCrmCaseActionAggregateContext(
  client: PoolClient,
  input: { readonly tenantId: string; readonly caseId: string },
): Promise<CrmCaseActionAggregateContext | null> {
  const result = await client.query<CrmCaseActionContextRow>(
    `SELECT
       c.case_id,
       c.subject,
       c.description,
       c.status,
       c.stage_key,
       c.owner_subject_id,
       contact.contact_id,
       contact.full_name AS contact_name,
       contact.email AS contact_email,
       contact.phone AS contact_phone,
       account.account_id,
       account.name AS account_name
     FROM platform.crm_cases c
     LEFT JOIN platform.crm_contacts contact
       ON contact.tenant_id = c.tenant_id
      AND contact.contact_id = c.contact_id
     LEFT JOIN platform.crm_accounts account
       ON account.tenant_id = c.tenant_id
      AND account.account_id = c.account_id
    WHERE c.tenant_id = $1::uuid
      AND c.case_id = $2::uuid
    LIMIT 1`,
    [input.tenantId, input.caseId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    caseId: row.case_id,
    subject: row.subject,
    description: row.description,
    status: row.status,
    stageKey: row.stage_key,
    ownerSubjectId: row.owner_subject_id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    accountId: row.account_id,
    accountName: row.account_name,
  };
}

function eventPackProvenance(event: {
  readonly packKey: string | null;
  readonly packVersion: number | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}): CrmCaseIndustryPackProvenance {
  const source = event.metadata.industryPackRuntimeSource;
  if (
    source !== 'TENANT_PUBLISHED'
    && source !== 'PLATFORM_PUBLISHED'
    && source !== 'CODE_BASELINE'
    && source !== 'NEUTRAL'
  ) {
    throw new Error('CRM_CASE_ACTION_EVENT_PACK_SOURCE_INVALID');
  }
  return {
    verticalKey: event.packKey,
    version: event.packVersion,
    runtimeSource: source,
  };
}

/**
 * Materialize and persist governed actions declared by the event's pinned
 * Industry Pack for one crm.case Domain Event.
 *
 * Concrete PII is read from the case/contact projection only at processing
 * time. Pack configuration stores binding instructions, never patient values.
 *
 * Rules with no additional policy keys are allowed by the binding/runtime
 * invariants plus their downstream executor governance. Rules that declare
 * policy keys fail closed unless an application policy evaluator is supplied.
 */
export async function materializeCrmCaseGovernedActionsForEvent(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly eventId: string;
    readonly policyEvaluator?: CrmCaseActionPolicyEvaluator;
    readonly now?: () => Date;
  },
): Promise<readonly CrmCaseGovernedActionResult[]> {
  const event = await loadDomainEvent(client, {
    tenantId: input.tenantId,
    eventId: input.eventId,
  });
  if (event === null) throw new Error('CRM_CASE_ACTION_EVENT_NOT_FOUND');
  if (event.aggregateType !== 'crm.case') {
    throw new Error('CRM_CASE_ACTION_AGGREGATE_TYPE_INVALID');
  }

  const pack = await loadPinnedCrmCaseIndustryPack(client, {
    tenantId: input.tenantId,
    provenance: eventPackProvenance(event),
  });
  const rules = resolveGovernedActionRules(pack, event.eventType);
  if (rules.length === 0) return [];

  const aggregate = await loadCrmCaseActionAggregateContext(client, {
    tenantId: input.tenantId,
    caseId: event.aggregateId,
  });
  if (aggregate === null) throw new Error('CRM_CASE_ACTION_AGGREGATE_NOT_FOUND');

  const evaluatedAt = input.now?.() ?? new Date();
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new Error('CRM_CASE_ACTION_CLOCK_INVALID');
  }

  const results: CrmCaseGovernedActionResult[] = [];
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
        reason: error instanceof Error ? error.message : 'Action binding failed.',
      });
      continue;
    }

    let decision: GovernedActionPolicyDecision;
    if (materializedRule.policyKeys.length === 0) {
      decision = {
        allowed: true,
        policyKeys: [],
        evidenceRefs: ['binding:materialized', `aggregate:crm.case:${event.aggregateId}`],
        reasonCode: 'NO_ADDITIONAL_POLICY_REQUIRED',
        evaluatedAt,
      };
    } else if (input.policyEvaluator === undefined) {
      results.push({
        status: 'SKIPPED',
        ruleKey: materializedRule.ruleKey,
        reasonCode: 'POLICY_EVALUATOR_REQUIRED',
        reason: 'This action rule declares policy keys but no evaluator was supplied.',
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
        reason: 'The action rule no longer matches this event.',
      });
      continue;
    }
    if (!resolved.allowed) {
      results.push({
        status: 'SKIPPED',
        ruleKey: materializedRule.ruleKey,
        reasonCode: resolved.reasonCode,
        reason: 'Governed action policy refused this action.',
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
