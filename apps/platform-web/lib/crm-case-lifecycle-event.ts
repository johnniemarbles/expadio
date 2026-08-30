import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  findIndustryPack,
  resolveCaseLifecycleEvent,
  type CrmCaseStage,
  type IndustryPack,
} from '@expadio/industry-packs';
import {
  appendDomainEventWithOutbox,
  type DomainEventOutboxAppendResult,
} from '@expadio/postgres-runtime/domain-events';

export interface CrmCaseIndustryPackProvenance {
  readonly verticalKey: string | null;
  readonly version: number | null;
  readonly runtimeSource:
    | 'TENANT_PUBLISHED'
    | 'PLATFORM_PUBLISHED'
    | 'CODE_BASELINE'
    | 'NEUTRAL'
    | null;
}

interface PublishedPackRow {
  readonly definition: IndustryPack;
}

async function loadPinnedPack(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly provenance: CrmCaseIndustryPackProvenance;
  },
): Promise<IndustryPack | null> {
  const source = input.provenance.runtimeSource;
  if (source === null || source === 'NEUTRAL') return null;

  const verticalKey = input.provenance.verticalKey?.trim().toLowerCase() ?? '';
  if (verticalKey === '') {
    throw new Error('CRM_CASE_EVENT_PACK_VERTICAL_KEY_MISSING');
  }

  if (source === 'CODE_BASELINE') {
    const pack = findIndustryPack(verticalKey);
    if (pack === null) throw new Error('CRM_CASE_EVENT_CODE_PACK_NOT_FOUND');
    return pack;
  }

  const version = input.provenance.version;
  if (version === null || !Number.isInteger(version) || version <= 0) {
    throw new Error('CRM_CASE_EVENT_PACK_VERSION_INVALID');
  }

  const result = await client.query<PublishedPackRow>(
    `SELECT definition
       FROM platform.industry_pack_versions
      WHERE lower(vertical_key) = $2
        AND version = $3
        AND state IN ('PUBLISHED','SUPERSEDED','ARCHIVED')
        AND (
          ($4 = 'TENANT_PUBLISHED' AND tenant_id = $1::uuid)
          OR
          ($4 = 'PLATFORM_PUBLISHED' AND tenant_id IS NULL)
        )
      LIMIT 1`,
    [input.tenantId, verticalKey, version, source],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('CRM_CASE_EVENT_PINNED_PACK_NOT_FOUND');
  }
  return row.definition;
}

function canonicalCaseStage(value: string | null | undefined): CrmCaseStage | null {
  if (
    value === 'INTAKE'
    || value === 'IN_PROGRESS'
    || value === 'REVIEW'
    || value === 'RESOLVED'
  ) {
    return value;
  }
  return null;
}

/**
 * Append the semantic lifecycle Domain Event declared by the case's *pinned*
 * Industry Pack. The generic workflow engine is not aware of vertical event
 * names; this application adapter runs only after a successful transition and
 * uses the same caller-owned transaction as the case/workflow mutation.
 */
export async function appendCrmCaseLifecycleEvent(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly caseId: string;
    readonly workflowInstanceId: string;
    readonly fromStageKey: string | null | undefined;
    readonly toStageKey: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly provenance: CrmCaseIndustryPackProvenance;
    readonly reason?: string;
    readonly occurredAt?: Date;
  },
): Promise<DomainEventOutboxAppendResult | null> {
  const toStageKey = canonicalCaseStage(input.toStageKey);
  if (toStageKey === null) return null;

  const pack = await loadPinnedPack(client, {
    tenantId: input.tenantId,
    provenance: input.provenance,
  });
  const mapping = resolveCaseLifecycleEvent(pack, toStageKey);
  if (mapping === null) return null;

  const fromStageKey = canonicalCaseStage(input.fromStageKey);
  const occurredAt = input.occurredAt ?? new Date();

  return appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'crm.case',
      aggregateId: input.caseId,
      eventType: mapping.eventType,
      eventVersion: mapping.eventVersion,
      occurredAt,
      recordedAt: occurredAt,
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      causationId: input.workflowInstanceId,
      packKey: input.provenance.verticalKey,
      packVersion: input.provenance.version,
      payload: {
        workflowInstanceId: input.workflowInstanceId,
        fromStageKey,
        toStageKey,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
      metadata: {
        source: 'crm.case.workflow-transition',
        industryPackRuntimeSource: input.provenance.runtimeSource,
      },
    },
  });
}
