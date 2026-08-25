import {
  validateIntelligenceUsageEvent,
  type IntelligenceUsageEvent,
  type IntelligenceUsageRepository,
  type RecordIntelligenceUsageResult,
  type UsageBudgetPosition,
  type UsagePositionQuery,
} from '@expadio/usage-metering';
import type { PostgresClient } from './index.ts';

interface UsageRow {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly organization_id: string | null;
  readonly meter: IntelligenceUsageEvent['meter'];
  readonly quantity: number | string;
  readonly cost_minor_units: number | string;
  readonly currency: string;
  readonly capability_key: string;
  readonly connector_key: string;
  readonly provider_key: string;
  readonly model_key: string | null;
  readonly provider_cost_ownership:
    IntelligenceUsageEvent['providerCostOwnership'];
  readonly work_reference: string;
  readonly occurred_at: Date | string;
  readonly recorded_at: Date | string;
  readonly correlation_id: string;
  readonly evidence_refs: readonly string[];
}

interface PositionRow {
  readonly committed_cost_minor_units: number | string;
}

export class PostgresIntelligenceUsageRepository
implements IntelligenceUsageRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async record(
    event: IntelligenceUsageEvent,
  ): Promise<RecordIntelligenceUsageResult> {
    validateIntelligenceUsageEvent(event);
    const result = await this.#client.query(
      `INSERT INTO platform.intelligence_usage_events (
         event_id, tenant_id, organization_id, meter, quantity,
         cost_minor_units, currency, capability_key, connector_key,
         provider_key, model_key, provider_cost_ownership,
         work_reference, occurred_at, recorded_at,
         correlation_id, evidence_refs
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14::timestamptz, $15::timestamptz,
         $16::uuid, $17::text[]
       )
       ON CONFLICT (event_id) DO NOTHING`,
      eventValues(event),
    );
    if (result.rowCount === 1) return { recorded: true, event };

    const existing = await this.findById(event.tenantId, event.eventId);
    if (existing === null) {
      throw new Error('USAGE_EVENT_CONFLICT_WITHOUT_VISIBLE_RECORD');
    }
    if (!same(existing, event)) {
      throw new Error('USAGE_EVENT_ID_CONFLICT');
    }
    return { recorded: false, event: existing };
  }

  async monthlyPosition(
    query: UsagePositionQuery,
  ): Promise<UsageBudgetPosition> {
    if (
      query.tenantId.trim() === ''
      || (query.organizationId !== null
        && query.organizationId.trim() === '')
      || !/^[A-Za-z]{3}$/.test(query.currency)
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.period)
    ) {
      throw new Error('USAGE_POSITION_QUERY_INVALID');
    }

    const result = await this.#client.query<PositionRow>(
      `SELECT COALESCE(sum(cost_minor_units), 0)::text
                AS committed_cost_minor_units
         FROM platform.intelligence_usage_events
        WHERE tenant_id = $1::uuid
          AND (
            organization_id = $2::uuid
            OR (organization_id IS NULL AND $2::uuid IS NULL)
          )
          AND currency = $3
          AND occurred_at >= $4::date
          AND occurred_at < ($4::date + interval '1 month')`,
      [
        query.tenantId,
        query.organizationId,
        query.currency.toUpperCase(),
        query.period + '-01',
      ],
    );
    const committed = Number(
      result.rows[0]?.committed_cost_minor_units ?? 0,
    );
    if (!Number.isSafeInteger(committed) || committed < 0) {
      throw new Error('USAGE_POSITION_COST_OUT_OF_RANGE');
    }
    return {
      tenantId: query.tenantId,
      organizationId: query.organizationId,
      currency: query.currency.toUpperCase(),
      period: query.period,
      committedCostMinorUnits: committed,
    };
  }

  private async findById(
    tenantId: string,
    eventId: string,
  ): Promise<IntelligenceUsageEvent | null> {
    const result = await this.#client.query<UsageRow>(
      USAGE_SELECT
        + ' WHERE tenant_id = $1::uuid AND event_id = $2::uuid LIMIT 1',
      [tenantId, eventId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapUsage(row);
  }
}

const USAGE_SELECT =
  `SELECT event_id, tenant_id, organization_id, meter, quantity,
          cost_minor_units, currency, capability_key, connector_key,
          provider_key, model_key, provider_cost_ownership,
          work_reference, occurred_at, recorded_at,
          correlation_id, evidence_refs
     FROM platform.intelligence_usage_events`;

function eventValues(event: IntelligenceUsageEvent): readonly unknown[] {
  return [
    event.eventId,
    event.tenantId,
    event.organizationId,
    event.meter,
    event.quantity,
    event.costMinorUnits,
    event.currency.toUpperCase(),
    event.capabilityKey,
    event.connectorKey,
    event.providerKey,
    event.modelKey,
    event.providerCostOwnership,
    event.workReference,
    event.occurredAt,
    event.recordedAt,
    event.correlationId,
    [...event.evidenceRefs],
  ];
}

function mapUsage(row: UsageRow): IntelligenceUsageEvent {
  const event: IntelligenceUsageEvent = {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    meter: row.meter,
    quantity: safeInteger(row.quantity),
    costMinorUnits: safeInteger(row.cost_minor_units),
    currency: row.currency,
    capabilityKey: row.capability_key,
    connectorKey: row.connector_key,
    providerKey: row.provider_key,
    modelKey: row.model_key,
    providerCostOwnership: row.provider_cost_ownership,
    workReference: row.work_reference,
    occurredAt: iso(row.occurred_at),
    recordedAt: iso(row.recorded_at),
    correlationId: row.correlation_id,
    evidenceRefs: [...row.evidence_refs],
  };
  return validateIntelligenceUsageEvent(event);
}

function safeInteger(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('USAGE_VALUE_OUT_OF_RANGE');
  }
  return parsed;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
