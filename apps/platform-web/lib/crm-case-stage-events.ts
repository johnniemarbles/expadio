import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { appendDomainEventWithOutbox } from '@expadio/postgres-runtime/domain-events';

export interface CrmCaseStageChangedInput {
  readonly tenantId: string;
  readonly caseId: string;
  readonly instanceId: string;
  readonly previousStageKey: string | null;
  readonly currentStageKey: string | null;
  readonly revision: number;
  readonly actorSubjectId: string;
  readonly correlationId?: string | null;
  readonly reason?: string;
  readonly pack: {
    readonly verticalKey: string | null;
    readonly version: number | null;
    readonly runtimeSource: string | null;
  };
}

/**
 * Append the generic CRM case stage-change fact using the caller's transaction.
 *
 * This is deliberately application-layer and vertical-neutral. Industry Packs
 * can later map this canonical fact to domain-facing lifecycle events/rules
 * without putting DENTEX/LEXFLOW branches into the Decision Fabric runtime.
 */
export async function appendCrmCaseStageChangedEvent(
  client: PoolClient,
  input: CrmCaseStageChangedInput,
) {
  const eventId = randomUUID();
  const suppliedCorrelationId = input.correlationId?.trim();
  const correlationId = suppliedCorrelationId && suppliedCorrelationId !== ''
    ? suppliedCorrelationId
    : eventId;

  return appendDomainEventWithOutbox(client, {
    event: {
      eventId,
      tenantId: input.tenantId,
      aggregateType: 'crm.case',
      aggregateId: input.caseId,
      eventType: 'crm.case.stage_changed',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId,
      causationId: `workflow:${input.instanceId}:revision:${input.revision}`,
      ...(input.pack.verticalKey === null ? {} : { packKey: input.pack.verticalKey }),
      ...(input.pack.version === null ? {} : { packVersion: input.pack.version }),
      payload: {
        previousStageKey: input.previousStageKey,
        currentStageKey: input.currentStageKey,
        workflowInstanceId: input.instanceId,
        workflowRevision: input.revision,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
      metadata: {
        source: 'decision-fabric.crm-case-transition',
        ...(input.pack.runtimeSource === null
          ? {}
          : { industryPackRuntimeSource: input.pack.runtimeSource }),
      },
    },
    topic: 'domain.events',
    partitionKey: `crm.case:${input.caseId}`,
  });
}
