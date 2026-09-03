import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { appendDomainEventWithOutbox } from '@expadio/postgres-runtime/domain-events';

export interface DemandCaptureRoutingResult {
  readonly captureLeadId: string;
  readonly outcome: 'ASSIGNED' | 'UNASSIGNED';
  readonly assignedSubjectId: string | null;
  readonly previousOwnerSubjectId: string | null;
  readonly routingRuleId: string | null;
  readonly routingRuleName: string | null;
  readonly reasonCode: 'MATCHED_RULE' | 'NO_VALID_ROUTE';
  readonly explanation: string;
  readonly replayed: boolean;
  readonly unassignedEventId: string | null;
}

interface LockedLead {
  organization_id: string;
  source_id: string;
  owner_subject_id: string | null;
}

interface RoutingRule {
  routing_rule_id: string;
  name: string;
  priority: number;
  target_subject_id: string;
}

interface AssignmentEvent {
  outcome: 'ASSIGNED' | 'UNASSIGNED';
  assigned_subject_id: string | null;
  routing_rule_id: string | null;
}

export async function routeDemandCaptureLead(
  client: pg.PoolClient,
  input: {
    tenantId: string;
    captureLeadId: string;
    actorSubjectId: string;
    issuer: string;
  },
): Promise<DemandCaptureRoutingResult | null> {
  const locked = await client.query<LockedLead>(
    `SELECT organization_id, source_id, owner_subject_id
       FROM platform.lead_capture_leads
      WHERE tenant_id = $1::uuid
        AND capture_lead_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, input.captureLeadId],
  );
  const lead = locked.rows[0];
  if (!lead) return null;

  const rules = await client.query<RoutingRule>(
    `SELECT routing_rule_id, name, priority, target_subject_id
       FROM platform.lead_capture_routing_rules
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND status = 'ACTIVE'
        AND (source_id IS NULL OR source_id = $3::uuid)
      ORDER BY priority ASC, routing_rule_id ASC`,
    [input.tenantId, lead.organization_id, lead.source_id],
  );

  let selected: RoutingRule | null = null;
  for (const rule of rules.rows) {
    const eligible = await client.query<{ allowed: boolean }>(
      `SELECT platform.subject_can_access_organization($1::uuid, $2, $3, $4::uuid) AS allowed`,
      [input.tenantId, rule.target_subject_id, input.issuer, lead.organization_id],
    );
    if (eligible.rows[0]?.allowed) {
      selected = rule;
      break;
    }
  }

  const outcome = selected ? 'ASSIGNED' as const : 'UNASSIGNED' as const;
  const assignedSubjectId = selected?.target_subject_id ?? null;
  const reasonCode = selected ? 'MATCHED_RULE' as const : 'NO_VALID_ROUTE' as const;
  const explanation = selected
    ? `Matched routing rule ${selected.name} at priority ${selected.priority}.`
    : rules.rows.length === 0
      ? 'No active routing rule matched this Demand Capture source.'
      : 'No matching routing rule had an active assignee authorized for this organization.';

  const latest = await client.query<AssignmentEvent>(
    `SELECT outcome, assigned_subject_id, routing_rule_id
       FROM platform.lead_capture_assignment_events
      WHERE tenant_id = $1::uuid
        AND capture_lead_id = $2::uuid
      ORDER BY created_at DESC, assignment_event_id DESC
      LIMIT 1`,
    [input.tenantId, input.captureLeadId],
  );
  const previous = latest.rows[0];
  const replayed = lead.owner_subject_id === assignedSubjectId
    && previous?.outcome === outcome
    && previous?.assigned_subject_id === assignedSubjectId
    && previous?.routing_rule_id === (selected?.routing_rule_id ?? null);

  if (replayed) {
    return {
      captureLeadId: input.captureLeadId,
      outcome,
      assignedSubjectId,
      previousOwnerSubjectId: lead.owner_subject_id,
      routingRuleId: selected?.routing_rule_id ?? null,
      routingRuleName: selected?.name ?? null,
      reasonCode,
      explanation,
      replayed: true,
      unassignedEventId: null,
    };
  }

  await client.query(
    `UPDATE platform.lead_capture_leads
        SET owner_subject_id = $3,
            updated_at = clock_timestamp()
      WHERE tenant_id = $1::uuid
        AND capture_lead_id = $2::uuid`,
    [input.tenantId, input.captureLeadId, assignedSubjectId],
  );

  const assignment = await client.query<{ assignment_event_id: string }>(
    `INSERT INTO platform.lead_capture_assignment_events (
       tenant_id, organization_id, capture_lead_id, routing_rule_id,
       outcome, assigned_subject_id, previous_owner_subject_id,
       reason_code, explanation, actor_subject_id
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)
     RETURNING assignment_event_id`,
    [
      input.tenantId,
      lead.organization_id,
      input.captureLeadId,
      selected?.routing_rule_id ?? null,
      outcome,
      assignedSubjectId,
      lead.owner_subject_id,
      reasonCode,
      explanation,
      input.actorSubjectId,
    ],
  );
  const assignmentEventId = assignment.rows[0]?.assignment_event_id;
  if (!assignmentEventId) throw new Error('DEMAND_CAPTURE_ASSIGNMENT_EVENT_INSERT_FAILED');

  let unassignedEventId: string | null = null;
  if (outcome === 'UNASSIGNED') {
    const occurredAt = new Date();
    const appended = await appendDomainEventWithOutbox(client, {
      event: {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateType: 'lead.capture',
        aggregateId: input.captureLeadId,
        eventType: 'LeadCapture.RoutingUnassigned',
        eventVersion: 1,
        occurredAt,
        recordedAt: occurredAt,
        actorSubjectId: input.actorSubjectId,
        correlationId: `lead-capture:${input.captureLeadId}:routing`,
        causationId: assignmentEventId,
        packKey: null,
        packVersion: null,
        payload: {
          captureLeadId: input.captureLeadId,
          organizationId: lead.organization_id,
          sourceId: lead.source_id,
          previousOwnerSubjectId: lead.owner_subject_id,
          reasonCode,
          explanation,
        },
        metadata: {
          source: 'lead.capture.routing',
          assignmentEventId,
        },
      },
    });
    unassignedEventId = appended.event.eventId;
  }

  return {
    captureLeadId: input.captureLeadId,
    outcome,
    assignedSubjectId,
    previousOwnerSubjectId: lead.owner_subject_id,
    routingRuleId: selected?.routing_rule_id ?? null,
    routingRuleName: selected?.name ?? null,
    reasonCode,
    explanation,
    replayed: false,
    unassignedEventId,
  };
}
