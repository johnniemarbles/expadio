import { randomUUID } from 'node:crypto';
import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_PRIVATE_URL;

if (!dbUrl) {
  console.log('Skipping schema verification: DATABASE_URL not set in environment.');
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: dbUrl });
const client = await pool.connect().catch((err) => {
  console.warn('Warning: Could not connect to PostgreSQL for schema verification:', err.message);
  process.exit(0);
});

function safeDbError(error) {
  if (!error || typeof error !== 'object') return { message: String(error) };
  return {
    message: typeof error.message === 'string' ? error.message : String(error),
    code: typeof error.code === 'string' ? error.code : undefined,
    schema: typeof error.schema === 'string' ? error.schema : undefined,
    table: typeof error.table === 'string' ? error.table : undefined,
    constraint: typeof error.constraint === 'string' ? error.constraint : undefined,
  };
}

try {
  const structure = await client.query(`
    SELECT
      to_regclass('platform.domain_events') AS domain_events,
      to_regclass('platform.domain_event_outbox') AS domain_event_outbox,
      to_regprocedure('platform.current_tenant_id()') AS tenant_function
  `);
  const row = structure.rows[0] ?? {};
  const missing = Object.entries(row).filter(([, value]) => value === null).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`RUNTIME_SCHEMA_MISSING: ${missing.join(', ')}`);
  }

  const rls = await client.query(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform'
       AND c.relname IN ('domain_events','domain_event_outbox')
  `);
  for (const item of rls.rows) {
    if (!item.relrowsecurity || !item.relforcerowsecurity) {
      throw new Error(`RUNTIME_SCHEMA_RLS_NOT_ENFORCED: ${item.relname}`);
    }
  }

  const policies = await client.query(`
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'platform'
       AND policyname IN (
         'domain_events_tenant_select',
         'domain_events_tenant_insert',
         'domain_event_outbox_tenant_all'
       )
  `);
  if (policies.rowCount !== 3) {
    throw new Error('RUNTIME_SCHEMA_POLICY_MISSING: domain event/outbox tenant policies are incomplete.');
  }

  const tenant = await client.query('SELECT tenant_id FROM platform.tenants LIMIT 1');
  if (!tenant.rows[0]) {
    throw new Error('RUNTIME_SCHEMA_PREFLIGHT_NO_TENANT: bootstrap seed did not create a tenant.');
  }

  const tenantId = tenant.rows[0].tenant_id;
  const eventId = randomUUID();
  const correlationId = randomUUID();

  await client.query('BEGIN');
  try {
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    await client.query(
      `INSERT INTO platform.domain_events (
         event_id, tenant_id, aggregate_type, aggregate_id, event_type,
         event_version, occurred_at, actor_subject_id, correlation_id, payload, metadata
       ) VALUES (
         $1::uuid, $2::uuid, 'platform.runtime_preflight', $3,
         'platform.runtime.audit.preflight', 1, now(), 'platform-startup',
         $4, '{}'::jsonb, '{"source":"platform.startup-preflight"}'::jsonb
       )`,
      [eventId, tenantId, `startup:${eventId}`, correlationId],
    );
    await client.query(
      `INSERT INTO platform.domain_event_outbox (tenant_id, event_id, topic, partition_key)
       VALUES ($1::uuid, $2::uuid, 'domain.events', $3)`,
      [tenantId, eventId, `platform.runtime_preflight:${eventId}`],
    );
    await client.query('ROLLBACK');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  }

  console.log('✅ Runtime audit/outbox schema preflight passed.');
} catch (error) {
  console.error('❌ Runtime audit/outbox schema preflight failed:', safeDbError(error));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
