import type { Pool } from 'pg';
import {
  dayWindowKey,
  evaluateSpendCap,
  evaluateThrottle,
  minuteWindowKey,
  type CommunicationSpendRepository,
  type CommunicationThrottleRepository,
  type SpendCapEvaluation,
  type ThrottleConsumeRequest,
  type ThrottleConsumeResult,
} from '@expadio/communication';
import type { CommunicationPlane } from '@expadio/communication';

/**
 * Design spec §3.1 step 13 — "consume, not read".
 *
 * PORTED FROM BEMP AS-IS: the atomic INSERT ... ON CONFLICT DO UPDATE counter
 * inside a transaction (CommunicationThrottleService.consume). It is proven
 * correct under concurrent app instances. The changes here are:
 *   · the `plane` key column (BEMP C14 / design spec §0.5)
 *   · an explicit ROLLBACK on refusal, so a refused send does not burn a slot
 *   · a typed refusal instead of a thrown BadRequestException, because
 *     silent-or-thrown failure is BEMP C9 and this must reach the trace.
 */
export class PostgresCommunicationThrottleRepository implements CommunicationThrottleRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async consume(request: ThrottleConsumeRequest): Promise<ThrottleConsumeResult> {
    const at = request.at ?? new Date();
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', request.tenantId]);

      const minute = await client.query<{ count: string }>(
        `INSERT INTO platform.communication_throttle_windows
           (tenant_id, plane, window_type, window_key, count, updated_at)
         VALUES ($1::uuid, $2, 'MINUTE', $3, 1, now())
         ON CONFLICT (tenant_id, plane, window_type, window_key)
         DO UPDATE SET count = platform.communication_throttle_windows.count + 1,
                       updated_at = now()
         RETURNING count`,
        [request.tenantId, request.plane, minuteWindowKey(at)],
      );

      const day = await client.query<{ count: string }>(
        `INSERT INTO platform.communication_throttle_windows
           (tenant_id, plane, window_type, window_key, count, updated_at)
         VALUES ($1::uuid, $2, 'DAY', $3, 1, now())
         ON CONFLICT (tenant_id, plane, window_type, window_key)
         DO UPDATE SET count = platform.communication_throttle_windows.count + 1,
                       updated_at = now()
         RETURNING count`,
        [request.tenantId, request.plane, dayWindowKey(at)],
      );

      const result = evaluateThrottle({
        minuteCount: Number(minute.rows[0]?.count ?? 0),
        dayCount: Number(day.rows[0]?.count ?? 0),
        limits: request.limits,
      });

      // A refused send must not consume a slot: roll the increments back.
      if (result.allowed) {
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async peek(input: {
    readonly tenantId: string;
    readonly plane: CommunicationPlane;
    readonly at?: Date;
  }): Promise<{ readonly minuteCount: number; readonly dayCount: number }> {
    const at = input.at ?? new Date();
    const client = await this.pool.connect();
    try {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', input.tenantId]);
      const result = await client.query<{ window_type: string; count: string }>(
        `SELECT window_type, count
           FROM platform.communication_throttle_windows
          WHERE tenant_id = $1::uuid AND plane = $2
            AND ((window_type = 'MINUTE' AND window_key = $3)
              OR (window_type = 'DAY' AND window_key = $4))`,
        [input.tenantId, input.plane, minuteWindowKey(at), dayWindowKey(at)],
      );
      let minuteCount = 0;
      let dayCount = 0;
      for (const row of result.rows) {
        if (row.window_type === 'MINUTE') minuteCount = Number(row.count);
        if (row.window_type === 'DAY') dayCount = Number(row.count);
      }
      return { minuteCount, dayCount };
    } finally {
      client.release();
    }
  }
}

/**
 * §4.2 / B19 — the spend breaker.
 *
 * Same transactional discipline: the spend is committed before the provider is
 * called, and rolled back when the cap refuses. A cost dashboard that reports
 * overspend after the fact is not a cap.
 */
export class PostgresCommunicationSpendRepository implements CommunicationSpendRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async consume(input: {
    readonly tenantId: string;
    readonly estimatedCostMinorUnits: number;
    readonly at?: Date;
  }): Promise<SpendCapEvaluation> {
    const at = input.at ?? new Date();
    const dayKey = at.toISOString().slice(0, 10);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', input.tenantId]);

      const row = await client.query<{
        daily_cap_minor_units: string | null;
        spent_today_minor_units: string;
        spend_day_key: string;
        breaker_state: string;
      }>(
        `SELECT daily_cap_minor_units, spent_today_minor_units, spend_day_key, breaker_state
           FROM platform.communication_spend_caps
          WHERE tenant_id = $1::uuid
          FOR UPDATE`,
        [input.tenantId],
      );

      // No cap configured: nothing to enforce.
      if (row.rows.length === 0) {
        await client.query('COMMIT');
        return {
          state: 'CLOSED', allowed: true, spentMinorUnits: 0,
          capMinorUnits: null, utilisationPct: 0,
        };
      }

      const current = row.rows[0]!;
      // Roll the day over inside the same lock so two workers cannot both reset.
      const spentToday = current.spend_day_key === dayKey
        ? Number(current.spent_today_minor_units)
        : 0;

      const evaluation = evaluateSpendCap({
        spentMinorUnits: spentToday,
        capMinorUnits: current.daily_cap_minor_units === null
          ? null
          : Number(current.daily_cap_minor_units),
        estimatedCostMinorUnits: input.estimatedCostMinorUnits,
      });

      if (!evaluation.allowed) {
        await client.query(
          `UPDATE platform.communication_spend_caps
              SET breaker_state = 'OPEN',
                  breaker_opened_at = coalesce(breaker_opened_at, now()),
                  spend_day_key = $2,
                  spent_today_minor_units = $3,
                  updated_at = now()
            WHERE tenant_id = $1::uuid`,
          [input.tenantId, dayKey, spentToday],
        );
        await client.query('COMMIT');
        return evaluation;
      }

      await client.query(
        `UPDATE platform.communication_spend_caps
            SET spent_today_minor_units = $3,
                spend_day_key = $2,
                breaker_state = $4,
                breaker_opened_at = NULL,
                updated_at = now()
          WHERE tenant_id = $1::uuid`,
        [
          input.tenantId,
          dayKey,
          spentToday + input.estimatedCostMinorUnits,
          evaluation.state === 'OPEN' ? 'WARNING' : evaluation.state,
        ],
      );
      await client.query('COMMIT');
      return evaluation;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async read(tenantId: string): Promise<SpendCapEvaluation> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      const row = await client.query<{
        daily_cap_minor_units: string | null;
        spent_today_minor_units: string;
      }>(
        `SELECT daily_cap_minor_units, spent_today_minor_units
           FROM platform.communication_spend_caps WHERE tenant_id = $1::uuid`,
        [tenantId],
      );
      if (row.rows.length === 0) {
        return { state: 'CLOSED', allowed: true, spentMinorUnits: 0, capMinorUnits: null, utilisationPct: 0 };
      }
      const current = row.rows[0]!;
      return evaluateSpendCap({
        spentMinorUnits: Number(current.spent_today_minor_units),
        capMinorUnits: current.daily_cap_minor_units === null ? null : Number(current.daily_cap_minor_units),
        estimatedCostMinorUnits: 0,
      });
    } finally {
      client.release();
    }
  }
}
