import type { PoolClient } from 'pg';
import {
  resolveGovernedAction,
  type GovernedActionRule,
  type GovernedActionPolicyDecision,
} from '@expadio/governed-actions';
import { loadDomainEvent } from '@expadio/postgres-runtime/domain-events';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import {
  persistGovernedActionIntent,
  type PersistedGovernedActionIntent,
} from '@expadio/postgres-runtime/governed-action-intent';

const EVENT_TYPE = 'LeadCapture.RoutingUnassigned';
const RULE_KEY = 'lead.capture.routing.unassigned.create-task.v1';

export type DemandCaptureGovernedActionResult =
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

export async function materializeDemandCaptureGovernedActionsForEvent(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly eventId: string;
    readonly now?: () => Date;
  },
): Promise<readonly DemandCaptureGovernedActionResult[]> {
  const event = await loadDomainEvent(client, {
    tenantId: input.tenantId,
    eventId: input.eventId,
  });
  if (event === null) throw new Error('DEMAND_CAPTURE_ACTION_EVENT_NOT_FOUND');
  if (event.aggregateType !== 'lead.capture') {
    throw new Error('DEMAND_CAPTURE_ACTION_AGGREGATE_TYPE_INVALID');
  }
  if (event.eventType !== EVENT_TYPE) return [];

  const module = await loadTenantProductModule(client, {
    tenantId: input.tenantId,
    moduleKey: 'lead-management',
  });
  if (module?.availability !== 'ACTIVE') return [];

  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId.trim()
    : '';
  const explanation = typeof event.payload.explanation === 'string'
    ? event.payload.explanation.trim()
    : '';
  if (organizationId === '' || explanation === '') {
    return [{
      status: 'SKIPPED',
      ruleKey: RULE_KEY,
      reasonCode: 'BINDING_FAILED',
      reason: 'UNASSIGNED routing event is missing organization or explanation evidence.',
    }];
  }

  const rule: GovernedActionRule = {
    ruleKey: RULE_KEY,
    eventType: EVENT_TYPE,
    executorClass: 'CREATE_TASK',
    actionKey: 'lead.capture.routing.resolve_unassigned',
    enabled: true,
    policyKeys: [],
    configuration: {
      title: 'Route unassigned Demand Capture lead',
      description: `${explanation} Capture Lead ${event.aggregateId}; organization ${organizationId}.`,
      assigneeSubjectId: null,
      dueAt: null,
      priority: 'HIGH',
    },
  };

  const evaluatedAt = input.now?.() ?? new Date();
  if (Number.isNaN(evaluatedAt.getTime())) throw new Error('DEMAND_CAPTURE_ACTION_CLOCK_INVALID');
  const decision: GovernedActionPolicyDecision = {
    allowed: true,
    policyKeys: [],
    evidenceRefs: [
      `domain.event:${event.eventId}`,
      `lead.capture:${event.aggregateId}`,
      `organization:${organizationId}`,
    ],
    reasonCode: 'NO_ADDITIONAL_POLICY_REQUIRED',
    evaluatedAt,
  };

  const resolved = resolveGovernedAction(event, rule, decision);
  if (!resolved.matched) return [];
  if (!resolved.allowed) {
    return [{
      status: 'SKIPPED',
      ruleKey: RULE_KEY,
      reasonCode: resolved.reasonCode,
      reason: 'Governed action policy refused the unassigned routing follow-up task.',
    }];
  }

  return [{
    status: 'PERSISTED',
    ruleKey: RULE_KEY,
    intent: await persistGovernedActionIntent(client, resolved.intent),
  }];
}
