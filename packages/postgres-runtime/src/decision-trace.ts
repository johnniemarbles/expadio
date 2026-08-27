import type { Pool } from 'pg';
import type {
  DecisionTrace,
  DecisionTraceRepository,
  GateRecord,
  TraceOutcome,
} from '@expadio/communication';

interface TraceRow {
  trace_id: string;
  tenant_id: string;
  organization_id: string | null;
  message_id: string | null;
  kind: string;
  outcome: string;
  reason_code: string | null;
  stopped_at_gate: number | null;
  gates: unknown;
  connectors_considered: unknown;
  connectors_rejected: unknown;
  compliance_pack_versions: unknown;
  correlation_id: string;
  created_at: Date;
  expires_at: Date;
}

function toTrace(row: TraceRow): DecisionTrace {
  return {
    traceId: row.trace_id,
    tenantId: row.tenant_id,
    ...(row.organization_id !== null ? { organizationId: row.organization_id } : {}),
    ...(row.message_id !== null ? { messageId: row.message_id } : {}),
    kind: row.kind as DecisionTrace['kind'],
    outcome: row.outcome as TraceOutcome,
    ...(row.reason_code !== null ? { reasonCode: row.reason_code } : {}),
    ...(row.stopped_at_gate !== null ? { stoppedAtGate: row.stopped_at_gate } : {}),
    gates: row.gates as readonly GateRecord[],
    connectorsConsidered: row.connectors_considered as readonly string[],
    connectorsRejected: row.connectors_rejected as Readonly<Record<string, readonly string[]>>,
    compliancePackVersions: row.compliance_pack_versions as Readonly<Record<string, string>>,
    correlationId: row.correlation_id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

export class PostgresDecisionTraceRepository implements DecisionTraceRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async record(trace: DecisionTrace): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', trace.tenantId]);
      await client.query(
        `INSERT INTO platform.communication_decision_traces
           (trace_id, tenant_id, organization_id, message_id, kind, outcome, reason_code,
            stopped_at_gate, gates, connectors_considered, connectors_rejected,
            compliance_pack_versions, correlation_id, expires_at, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8,
                 $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14::timestamptz, $15::timestamptz)
         ON CONFLICT (trace_id) DO NOTHING`,
        [
          trace.traceId,
          trace.tenantId,
          trace.organizationId ?? null,
          trace.messageId ?? null,
          trace.kind,
          trace.outcome,
          trace.reasonCode ?? null,
          trace.stoppedAtGate ?? null,
          JSON.stringify(trace.gates),
          JSON.stringify(trace.connectorsConsidered),
          JSON.stringify(trace.connectorsRejected),
          JSON.stringify(trace.compliancePackVersions),
          trace.correlationId,
          trace.expiresAt,
          trace.createdAt,
        ],
      );
    } finally {
      client.release();
    }
  }

  async findById(input: { readonly tenantId: string; readonly traceId: string }): Promise<DecisionTrace | null> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', input.tenantId]);
      const result = await client.query<TraceRow>(
        `SELECT * FROM platform.communication_decision_traces
          WHERE trace_id = $1::uuid AND tenant_id = $2::uuid`,
        [input.traceId, input.tenantId],
      );
      const row = result.rows[0];
      return row === undefined ? null : toTrace(row);
    } finally {
      client.release();
    }
  }

  async list(input: {
    readonly tenantId: string;
    readonly messageId?: string;
    readonly outcome?: TraceOutcome;
    readonly reasonCode?: string;
    readonly from?: string;
    readonly to?: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<{ readonly traces: readonly DecisionTrace[]; readonly total: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', input.tenantId]);

      const clauses: string[] = ['tenant_id = $1::uuid'];
      const params: unknown[] = [input.tenantId];

      if (input.messageId !== undefined) {
        params.push(input.messageId);
        clauses.push(`message_id = $${params.length}::uuid`);
      }
      if (input.outcome !== undefined) {
        params.push(input.outcome);
        clauses.push(`outcome = $${params.length}`);
      }
      if (input.reasonCode !== undefined) {
        params.push(input.reasonCode);
        clauses.push(`reason_code = $${params.length}`);
      }
      if (input.from !== undefined) {
        params.push(input.from);
        clauses.push(`created_at >= $${params.length}::timestamptz`);
      }
      if (input.to !== undefined) {
        params.push(input.to);
        clauses.push(`created_at <= $${params.length}::timestamptz`);
      }

      const where = clauses.join(' AND ');
      const totalResult = await client.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM platform.communication_decision_traces WHERE ${where}`,
        params,
      );

      params.push(Math.min(Math.max(input.limit, 1), 100));
      params.push(Math.max(input.offset, 0));

      const result = await client.query<TraceRow>(
        `SELECT * FROM platform.communication_decision_traces
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      return {
        traces: result.rows.map(toTrace),
        total: Number(totalResult.rows[0]?.total ?? 0),
      };
    } finally {
      client.release();
    }
  }
}
