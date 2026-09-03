import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { routeDemandCaptureLead } from '../../brand-web/lib/demand-capture-routing.ts';

const APP_ROLE = 'expadio_capture_routing_tester';
const APP_ROLE_PASSWORD = 'capture_routing_test';
const ISSUER = 'https://clerk.expadio.com';

function info() {
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'expadio_test',
  };
}

function superuserPool() {
  return new pg.Pool({ ...info(), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres', max: 1 });
}

function appPool() {
  return new pg.Pool({ ...info(), user: APP_ROLE, password: APP_ROLE_PASSWORD, max: 1 });
}

async function ensureRole(client: pg.PoolClient) {
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
      CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  await client.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_ROLE_PASSWORD}'`);
  await client.query(`GRANT USAGE ON SCHEMA platform TO ${APP_ROLE}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO ${APP_ROLE}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO ${APP_ROLE}`);
}

async function setContext(client: pg.PoolClient, input: { tenantId: string; organizationId: string; subjectId: string }) {
  await client.query(
    `SELECT set_config('app.tenant_id',$1,false),
            set_config('app.organization_id',$2,false),
            set_config('app.subject_id',$3,false),
            set_config('app.issuer',$4,false)`,
    [input.tenantId, input.organizationId, input.subjectId, ISSUER],
  );
}

test('Demand Capture routing falls through invalid targets and records explicit UNASSIGNED outcomes', async () => {
  const su = superuserPool();
  const admin = await su.connect();
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const siblingOrganizationId = randomUUID();
  const actorSubjectId = `routing_actor_${randomUUID()}`;
  const invalidTargetSubjectId = `routing_invalid_${randomUUID()}`;
  const validTargetSubjectId = `routing_valid_${randomUUID()}`;
  let app: pg.Pool | null = null;

  try {
    await ensureRole(admin);
    await admin.query(`INSERT INTO platform.tenants (tenant_id,name) VALUES ($1,'capture-routing')`, [tenantId]);
    await admin.query(
      `INSERT INTO platform.organizations (organization_id,tenant_id,name) VALUES
       ($1,$3,'Routing Org'),($2,$3,'Sibling Org')`,
      [organizationId, siblingOrganizationId, tenantId],
    );
    await admin.query(
      `INSERT INTO platform.memberships
         (tenant_id, organization_id, subject_id, issuer, actor_kind, organization_scope_mode)
       VALUES
         ($1,$2,$3,$5,'user','SELF_AND_DESCENDANTS'),
         ($1,$2,$4,$5,'user','SELF'),
         ($1,$6,$7,$5,'user','SELF')`,
      [tenantId, organizationId, actorSubjectId, validTargetSubjectId, ISSUER, siblingOrganizationId, invalidTargetSubjectId],
    );

    const sourceId = (await admin.query(
      `INSERT INTO platform.lead_capture_sources
         (tenant_id,organization_id,source_key,surface,require_signed_ticket,status)
       VALUES ($1,$2,'routing-source','WEBHOOK',false,'ACTIVE') RETURNING source_id`,
      [tenantId, organizationId],
    )).rows[0].source_id as string;
    const captureLeadId = (await admin.query(
      `INSERT INTO platform.lead_capture_leads
         (tenant_id,organization_id,source_id,title,stage,status,raw_payload)
       VALUES ($1,$2,$3,'Routing lead','NEW_ENQUIRY','ACTIVE','{}'::jsonb)
       RETURNING capture_lead_id`,
      [tenantId, organizationId, sourceId],
    )).rows[0].capture_lead_id as string;

    const invalidRuleId = (await admin.query(
      `INSERT INTO platform.lead_capture_routing_rules
         (tenant_id,organization_id,name,priority,source_id,target_subject_id,status,created_by_subject_id)
       VALUES ($1,$2,'Invalid first',10,$3,$4,'ACTIVE','itest') RETURNING routing_rule_id`,
      [tenantId, organizationId, sourceId, invalidTargetSubjectId],
    )).rows[0].routing_rule_id as string;
    const validRuleId = (await admin.query(
      `INSERT INTO platform.lead_capture_routing_rules
         (tenant_id,organization_id,name,priority,source_id,target_subject_id,status,created_by_subject_id)
       VALUES ($1,$2,'Valid fallback',20,$3,$4,'ACTIVE','itest') RETURNING routing_rule_id`,
      [tenantId, organizationId, sourceId, validTargetSubjectId],
    )).rows[0].routing_rule_id as string;

    app = appPool();
    const client = await app.connect();
    try {
      const privilege = await client.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`);
      assert.equal(privilege.rows[0].rolsuper, false);
      assert.equal(privilege.rows[0].rolbypassrls, false);
      await setContext(client, { tenantId, organizationId, subjectId: actorSubjectId });
      await client.query('BEGIN');

      const invalidEligibility = await client.query<{ allowed: boolean }>(
        `SELECT platform.subject_can_access_organization($1::uuid,$2,$3,$4::uuid) AS allowed`,
        [tenantId, invalidTargetSubjectId, ISSUER, organizationId],
      );
      const validEligibility = await client.query<{ allowed: boolean }>(
        `SELECT platform.subject_can_access_organization($1::uuid,$2,$3,$4::uuid) AS allowed`,
        [tenantId, validTargetSubjectId, ISSUER, organizationId],
      );
      assert.equal(invalidEligibility.rows[0].allowed, false);
      assert.equal(validEligibility.rows[0].allowed, true);

      const assigned = await routeDemandCaptureLead(client, {
        tenantId,
        captureLeadId,
        actorSubjectId,
        issuer: ISSUER,
      });
      assert.ok(assigned);
      assert.equal(assigned.outcome, 'ASSIGNED');
      assert.equal(assigned.routingRuleId, validRuleId);
      assert.equal(assigned.assignedSubjectId, validTargetSubjectId);
      assert.equal(assigned.reasonCode, 'MATCHED_RULE');
      assert.equal(assigned.replayed, false);

      const owner = await client.query(`SELECT owner_subject_id FROM platform.lead_capture_leads WHERE capture_lead_id=$1`, [captureLeadId]);
      assert.equal(owner.rows[0].owner_subject_id, validTargetSubjectId);
      const firstEvents = await client.query(
        `SELECT outcome,routing_rule_id,assigned_subject_id,previous_owner_subject_id,reason_code
           FROM platform.lead_capture_assignment_events WHERE capture_lead_id=$1`,
        [captureLeadId],
      );
      assert.deepEqual(firstEvents.rows[0], {
        outcome: 'ASSIGNED',
        routing_rule_id: validRuleId,
        assigned_subject_id: validTargetSubjectId,
        previous_owner_subject_id: null,
        reason_code: 'MATCHED_RULE',
      });

      const replay = await routeDemandCaptureLead(client, {
        tenantId,
        captureLeadId,
        actorSubjectId,
        issuer: ISSUER,
      });
      assert.equal(replay?.replayed, true);
      const replayCount = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM platform.lead_capture_assignment_events WHERE capture_lead_id=$1`,
        [captureLeadId],
      );
      assert.equal(replayCount.rows[0].count, 1);

      await client.query(
        `UPDATE platform.lead_capture_routing_rules SET status='DISABLED' WHERE routing_rule_id=$1`,
        [validRuleId],
      );
      const unassigned = await routeDemandCaptureLead(client, {
        tenantId,
        captureLeadId,
        actorSubjectId,
        issuer: ISSUER,
      });
      assert.ok(unassigned);
      assert.equal(unassigned.outcome, 'UNASSIGNED');
      assert.equal(unassigned.assignedSubjectId, null);
      assert.equal(unassigned.routingRuleId, null);
      assert.equal(unassigned.reasonCode, 'NO_VALID_ROUTE');
      assert.equal(unassigned.replayed, false);

      const secondEvents = await client.query(
        `SELECT outcome,assigned_subject_id,previous_owner_subject_id,reason_code
           FROM platform.lead_capture_assignment_events
          WHERE capture_lead_id=$1 ORDER BY created_at ASC,assignment_event_id ASC`,
        [captureLeadId],
      );
      assert.equal(secondEvents.rows.length, 2);
      assert.deepEqual(secondEvents.rows[1], {
        outcome: 'UNASSIGNED',
        assigned_subject_id: null,
        previous_owner_subject_id: validTargetSubjectId,
        reason_code: 'NO_VALID_ROUTE',
      });

      const unassignedReplay = await routeDemandCaptureLead(client, {
        tenantId,
        captureLeadId,
        actorSubjectId,
        issuer: ISSUER,
      });
      assert.equal(unassignedReplay?.replayed, true);

      const eventId = (await client.query(
        `SELECT assignment_event_id FROM platform.lead_capture_assignment_events
          WHERE capture_lead_id=$1 ORDER BY created_at DESC,assignment_event_id DESC LIMIT 1`,
        [captureLeadId],
      )).rows[0].assignment_event_id as string;
      const tamper = await client.query(
        `UPDATE platform.lead_capture_assignment_events SET explanation='tampered' WHERE assignment_event_id=$1`,
        [eventId],
      );
      assert.equal(tamper.rowCount, 0, 'app role must have no assignment-event mutation path through RLS');

      const visibleRules = await client.query(
        `SELECT routing_rule_id FROM platform.lead_capture_routing_rules ORDER BY priority`,
      );
      assert.deepEqual(visibleRules.rows.map((row) => row.routing_rule_id), [invalidRuleId, validRuleId]);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  } finally {
    await admin.query(`DELETE FROM platform.lead_capture_routing_rules WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_capture_leads WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.lead_capture_sources WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.memberships WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.organizations WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    await admin.query(`DELETE FROM platform.tenants WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
    admin.release();
    await su.end();
    if (app) await app.end();
  }
});
