// Optional isolated PostgreSQL-engine verification. No production database is used.
// Supply TENANT_PGLITE_MODULE with an installed @electric-sql/pglite module path.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readCustomer, readCustomers, readWork, withTenantRead } from '../lib/tenant-read-model.ts';

const { PGlite } = await import(process.env.TENANT_PGLITE_MODULE ?? '@electric-sql/pglite');
const db = new PGlite();
const migration = name => new URL(`../../../infra/db/migrations/${name}`, import.meta.url);
const client = { query: (sql, params) => db.query(sql, params), release() {} };
const pool = { connect: async () => client };
let checks = 0;
try {
  // Minimal dependencies of the unchanged migrations under test. Task/event
  // executors are outside this read-model test and are not simulated here.
  await db.exec(`CREATE SCHEMA platform;
    CREATE FUNCTION platform.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
    CREATE TABLE platform.connectors (tenant_id uuid);
    CREATE TABLE platform.connector_routing_policies (tenant_id uuid);
    CREATE TABLE platform.tenant_capability_bindings (tenant_id uuid, organization_id uuid);`);
  for (const name of ['0002_tenancy_memberships.sql', '0044_crm_party.sql', '0046_crm_cases.sql', '0014_workflow_instances.sql', '0015_workflow_stage_decisions.sql']) {
    await db.exec(await readFile(migration(name), 'utf8'));
  }
  await db.exec(`CREATE TABLE platform.domain_events (event_id uuid, tenant_id uuid, UNIQUE(event_id, tenant_id));
    CREATE TABLE platform.governed_action_intents (action_intent_id uuid, tenant_id uuid, UNIQUE(action_intent_id, tenant_id));`);
  await db.exec(await readFile(migration('0073_operational_tasks.sql'), 'utf8'));
  const [tenant, otherTenant, org, siblingOrg, otherOrg] = Array.from({ length: 5 }, randomUUID);
  await db.query('INSERT INTO platform.tenants(tenant_id, name) VALUES ($1, $2), ($3, $4)', [tenant, 'Allowed brand', otherTenant, 'Secret brand']);
  for (const [id, tenantId, name] of [[org, tenant, 'Allowed org'], [siblingOrg, tenant, 'Sibling org'], [otherOrg, otherTenant, 'Secret org']]) {
    await db.query('INSERT INTO platform.organizations(organization_id, tenant_id, name) VALUES ($1,$2,$3)', [id, tenantId, name]);
  }
  await db.query(`INSERT INTO platform.memberships(tenant_id, organization_id, subject_id, actor_kind, issuer)
    VALUES ($1,$2,'alice','user','https://clerk.expadio.com')`, [tenant, org]);
  await db.query(`INSERT INTO platform.memberships(tenant_id, organization_id, subject_id, actor_kind, issuer, operating_unit_scope_mode)
    VALUES ($1,$2,'limited','user','https://clerk.expadio.com','SELECTED')`, [tenant, org]);
  await db.query(`INSERT INTO platform.memberships(tenant_id, organization_id, subject_id, actor_kind, issuer, valid_from, valid_until)
    VALUES ($1,$2,'expired','user','https://clerk.expadio.com',now()-interval '2 days',now()-interval '1 day')`, [tenant, org]);
  const customers = [];
  for (const [tenantId, organizationId, name] of [[tenant, org, 'Allowed customer'], [tenant, siblingOrg, 'Sibling customer'], [otherTenant, otherOrg, 'Secret customer']]) {
    const [account, contact, caseId, instance, event, intent, taskId] = Array.from({ length: 7 }, randomUUID);
    customers.push({ account, contact, caseId, instance });
    await db.query('INSERT INTO platform.crm_accounts(account_id, tenant_id, organization_id, name) VALUES ($1,$2,$3,$4)', [account, tenantId, organizationId, name + ' account']);
    await db.query('INSERT INTO platform.crm_contacts(contact_id, tenant_id, account_id, full_name) VALUES ($1,$2,$3,$4)', [contact, tenantId, account, name]);
    await db.query(`INSERT INTO platform.workflow_instances(instance_id, tenant_id, work_type_key, subject_type, subject_id, blueprint_key, blueprint_version, blueprint_scope, state, created_at, updated_at)
      VALUES ($1,$2,'case','crm.case',$3,'neutral',1,'TENANT','RUNNING',now(),now())`, [instance, tenantId, caseId]);
    await db.query('INSERT INTO platform.crm_cases(case_id, tenant_id, account_id, contact_id, subject, workflow_instance_id) VALUES ($1,$2,$3,$4,$5,$6)', [caseId, tenantId, account, contact, name + ' case', instance]);
    await db.query(`INSERT INTO platform.workflow_stage_decisions(decision_id, tenant_id, instance_id, work_type_key, stage_key, outcome, decided_by_subject_id, decided_at, code)
      VALUES ($1,$2,$3,'case','review','APPROVED','reviewer',now(),'TEST')`, [randomUUID(), tenantId, instance]);
    await db.query('INSERT INTO platform.domain_events VALUES ($1,$2)', [event, tenantId]);
    await db.query('INSERT INTO platform.governed_action_intents VALUES ($1,$2)', [intent, tenantId]);
    await db.query(`INSERT INTO platform.operational_tasks(task_id, tenant_id, source_action_intent_id, source_event_id, aggregate_type, aggregate_id, idempotency_key, title, assignee_subject_id, correlation_id, created_by_subject_id)
      VALUES ($1,$2,$3,$4,'crm.case',$5,$6,$7,'alice',$8,'maker')`, [taskId, tenantId, intent, event, caseId, randomUUID(), name + ' task', randomUUID()]);
  }
  // A same-tenant case inconsistently linked to another organization's account
  // must never be treated as a child of the visible contact.
  await db.query('INSERT INTO platform.crm_cases(tenant_id, account_id, contact_id, subject) VALUES ($1,$2,$3,$4)', [tenant, customers[1].account, customers[0].contact, 'Inconsistent case']);
  await db.query('INSERT INTO platform.crm_cases(tenant_id, account_id, contact_id, subject, workflow_instance_id) VALUES ($1,$2,$3,$4,$5)', [tenant, customers[0].account, customers[0].contact, 'Mislinked workflow', customers[1].instance]);
  await db.query('INSERT INTO platform.crm_contacts(tenant_id, full_name) VALUES ($1,$2)', [tenant, 'Unowned contact']);
  await db.exec(`CREATE ROLE tenant_reader NOLOGIN NOBYPASSRLS;
    GRANT USAGE ON SCHEMA platform TO tenant_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA platform TO tenant_reader;
    SET ROLE tenant_reader;`);
  const identity = { tenantId: tenant, organizationId: org, subjectId: 'alice' };
  const list = await withTenantRead(pool, identity, (c) => readCustomers(c, identity, { limit: 50, offset: 0 }));
  assert.deepEqual(list.items.map(row => row.name), ['Allowed customer']); checks++;
  const detail = await withTenantRead(pool, identity, (c) => readCustomer(c, identity, customers[0].contact));
  assert.equal(detail.cases.length, 2); assert.equal(detail.tasks.length, 1); assert.equal(detail.decisions.length, 1); checks++;
  assert.equal(detail.decisions[0].outcome, 'APPROVED'); checks++;
  const work = await withTenantRead(pool, identity, (c) => readWork(c, identity, { limit: 50, offset: 0 }));
  assert.equal(work.items.length, 1); assert.equal(work.items[0].isMine, true); checks++;
  for (const customer of customers.slice(1)) {
    await assert.rejects(withTenantRead(pool, identity, c => readCustomer(c, identity, customer.contact)), error => error.status === 404); checks++;
  }
  for (const denied of [{ ...identity, organizationId: siblingOrg }, { ...identity, tenantId: otherTenant, organizationId: otherOrg }, { ...identity, subjectId: 'limited' }, { ...identity, subjectId: 'expired' }]) {
    let ran = false;
    await assert.rejects(withTenantRead(pool, denied, async () => { ran = true; }), error => error.status === 403);
    assert.equal(ran, false); checks++;
  }
  // Transaction-local context must not survive the request on a reused connection.
  assert.equal((await db.query('SELECT * FROM platform.crm_contacts')).rows.length, 0); checks++;
  await assert.rejects(withTenantRead(pool, identity, c => c.query("UPDATE platform.crm_contacts SET full_name = 'bad'"))); checks++;
  console.log(`Passed ${checks} PostgreSQL-engine checks, including non-bypass RLS, scoped child reads and read-only enforcement.`);
} finally { await db.close(); }
