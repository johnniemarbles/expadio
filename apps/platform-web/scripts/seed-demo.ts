/**
 * Demo dataset for the Decision Fabric.
 *
 * Populates the demo tenant with a realistic, fully-governed CRM + workflow
 * dataset so the running app is immediately explorable: accounts with contacts
 * and agreements, approval-authority grants, a tenant blueprint draft, and cases
 * driven through the real workflow runtime into distinct lifecycle states. Every
 * transition and decision is produced by the same runtime the app uses, so the
 * append-only transition log and immutable decision records are valid by
 * construction — this is not hand-written table data.
 *
 * Idempotent: it keys off a marker account and exits without changes if the demo
 * data is already present. Run with:
 *   node --experimental-strip-types --import ./test-integration/register.mjs scripts/seed-demo.ts
 * (wired as `pnpm seed:demo`). Connection comes from DATABASE_URL or PG* env; the
 * demo tenant/org can be overridden with DEMO_TENANT_ID / DEMO_ORG_ID.
 */
import pg from 'pg';
import { startWorkflow, transitionWorkflow, recordCaseDecision, makerForStage } from '../lib/workflow-runtime';
import { assignParticipant } from '../lib/workflow-participants';
import { grantAuthority } from '../lib/workflow-authority-grants';
import { createTenantDraftFromPlatform } from '../lib/workflow-blueprints';

const TENANT = process.env.DEMO_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';
const ORG = process.env.DEMO_ORG_ID ?? '00000000-0000-0000-0000-000000000002';
const MARKER = '[demo] Northwind Trading';

const APPROVER = 'demo-approver';
const MAKER = 'demo-maker';
const REVIEWER = 'demo-reviewer';

function makePool(): pg.Pool {
  if (process.env.DATABASE_URL) return new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 1,
  });
}

async function ensureRole(c: pg.PoolClient): Promise<string> {
  const existing = await c.query(
    `SELECT role_id FROM platform.authorization_roles WHERE tenant_id = $1::uuid AND role_key = 'TENANT_ADMIN' LIMIT 1`,
    [TENANT],
  );
  if (existing.rows[0]) return existing.rows[0].role_id as string;
  return (await c.query(
    `INSERT INTO platform.authorization_roles (role_key, display_name, ownership_scope, tenant_id, status)
     VALUES ('TENANT_ADMIN', 'Tenant Admin', 'TENANT', $1::uuid, 'ACTIVE') RETURNING role_id`,
    [TENANT],
  )).rows[0].role_id as string;
}

async function assignRole(c: pg.PoolClient, roleId: string, subjectId: string): Promise<void> {
  const held = await c.query(
    `SELECT 1 FROM platform.authorization_assignments WHERE tenant_id = $1::uuid AND subject_id = $2 AND role_id = $3::uuid LIMIT 1`,
    [TENANT, subjectId, roleId],
  );
  if (held.rows.length > 0) return;
  await c.query(
    `INSERT INTO platform.authorization_assignments (tenant_id, subject_id, role_id, status) VALUES ($1::uuid, $2, $3::uuid, 'ACTIVE')`,
    [TENANT, subjectId, roleId],
  );
}

async function makeAccount(c: pg.PoolClient, name: string, agreementMinor: number | null): Promise<string> {
  const accountId = (await c.query(
    `INSERT INTO platform.crm_accounts (tenant_id, organization_id, name, industry, lifecycle_stage)
     VALUES ($1::uuid, $2::uuid, $3, 'Software', 'CUSTOMER') RETURNING account_id`,
    [TENANT, ORG, name],
  )).rows[0].account_id as string;
  await c.query(
    `INSERT INTO platform.crm_contacts (tenant_id, account_id, full_name, email, title)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'Head of Operations')`,
    [TENANT, accountId, `${name.replace('[demo] ', '')} Lead`, `lead@${name.toLowerCase().replace(/[^a-z]/g, '')}.example`],
  );
  if (agreementMinor !== null) {
    await c.query(
      `INSERT INTO platform.crm_agreements (tenant_id, account_id, title, status, value_minor_units, currency, owner_subject_id)
       VALUES ($1::uuid, $2::uuid, 'Annual subscription', 'ACTIVE', $3, 'USD', $4)`,
      [TENANT, accountId, agreementMinor, APPROVER],
    );
  }
  return accountId;
}

async function makeCase(c: pg.PoolClient, accountId: string | null, subject: string, priority: string): Promise<string> {
  return (await c.query(
    `INSERT INTO platform.crm_cases (tenant_id, account_id, subject, priority, blueprint_key, owner_subject_id)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'crm.case', $5) RETURNING case_id`,
    [TENANT, accountId, subject, priority, MAKER],
  )).rows[0].case_id as string;
}

/** Start a case's workflow and mirror the instance link onto the case row. */
async function startCase(c: pg.PoolClient, caseId: string): Promise<{ instanceId: string; revision: number }> {
  const started = await startWorkflow(c, { tenantId: TENANT, subjectType: 'crm.case', subjectId: caseId, blueprintKey: 'crm.case' });
  if (!started.ok) throw new Error(`startWorkflow failed: ${started.reason}`);
  await mirror(c, caseId, started.instance.instanceId, started.instance.currentStageKey ?? null, 'OPEN');
  return { instanceId: started.instance.instanceId, revision: started.instance.revision };
}

async function advance(c: pg.PoolClient, caseId: string, instanceId: string, rev: number, toStageKey: string, by: string, status: string): Promise<number> {
  const t = await transitionWorkflow(c, { tenantId: TENANT, instanceId, expectedRevision: rev, toStageKey, requestedBySubjectId: by });
  if (!t.ok) throw new Error(`transition to ${toStageKey} blocked: ${t.reason}`);
  await mirror(c, caseId, instanceId, t.instance.currentStageKey ?? null, status);
  return t.instance.revision;
}

async function mirror(c: pg.PoolClient, caseId: string, instanceId: string, stageKey: string | null, status: string): Promise<void> {
  await c.query(
    `UPDATE platform.crm_cases SET workflow_instance_id = $2::uuid, stage_key = $3, status = $4, updated_at = now() WHERE case_id = $1::uuid`,
    [caseId, instanceId, stageKey, status],
  );
}

/**
 * Seed the demo dataset onto an already-connected client. Returns 'skipped' when
 * the marker account is already present (idempotent), else 'seeded'. Exposed so
 * the integration harness can exercise the same path CI-side.
 */
export async function seedDemo(c: pg.PoolClient): Promise<'seeded' | 'skipped'> {
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT]);

    const tenantExists = await c.query(`SELECT 1 FROM platform.tenants WHERE tenant_id = $1::uuid`, [TENANT]);
    if (tenantExists.rows.length === 0) {
      await c.query(`INSERT INTO platform.tenants (tenant_id, name, status) VALUES ($1::uuid, 'Demo Workspace', 'ACTIVE')`, [TENANT]);
    }
    const orgExists = await c.query(`SELECT 1 FROM platform.organizations WHERE organization_id = $1::uuid`, [ORG]);
    if (orgExists.rows.length === 0) {
      await c.query(
        `INSERT INTO platform.organizations (organization_id, tenant_id, organization_kind, name, status) VALUES ($1::uuid, $2::uuid, 'BUSINESS', 'Demo Org', 'ACTIVE')`,
        [ORG, TENANT],
      );
    }

    const marker = await c.query(`SELECT 1 FROM platform.crm_accounts WHERE tenant_id = $1::uuid AND name = $2`, [TENANT, MARKER]);
    if (marker.rows.length > 0) return 'skipped';

    const roleId = await ensureRole(c);
    await assignRole(c, roleId, APPROVER);

    // Approver holds a generous approval ceiling so decisions on cases with
    // ACTIVE agreements clear the monetary authority requirement.
    await grantAuthority(c, {
      tenantId: TENANT, subjectId: APPROVER, dimensionKey: 'monetary.approval',
      thresholdMinorUnits: 5_000_000, currency: 'USD', scopeType: 'TENANT', scopeEntityId: null,
      delegatedFromSubjectId: null, grantedBySubjectId: APPROVER,
    });

    const northwind = await makeAccount(c, MARKER, 750_000);
    const contoso = await makeAccount(c, '[demo] Contoso Ltd', 1_200_000);
    const fabrikam = await makeAccount(c, '[demo] Fabrikam Inc', null);

    // Case 1 — resolved end to end (COMPLETED): intake → in progress → review →
    // reviewer assigned → approved → resolved.
    {
      const caseId = await makeCase(c, northwind, '[demo] Customer onboarding review', 'HIGH');
      const { instanceId } = await startCase(c, caseId);
      let rev = (await c.query(`SELECT revision FROM platform.workflow_instances WHERE instance_id = $1::uuid`, [instanceId])).rows[0].revision as number;
      rev = await advance(c, caseId, instanceId, rev, 'IN_PROGRESS', MAKER, 'PENDING');
      await assignParticipant(c, { tenantId: TENANT, instanceId, stageKey: 'REVIEW', participantKey: 'reviewer', targetKind: 'USER', targetKey: REVIEWER, assignedBySubjectId: MAKER });
      rev = await advance(c, caseId, instanceId, rev, 'REVIEW', MAKER, 'PENDING');
      const maker = await makerForStage(c, { tenantId: TENANT, instanceId, stageKey: 'REVIEW' });
      const decision = await recordCaseDecision(c, { tenantId: TENANT, instanceId, workTypeKey: 'crm.case', stageKey: 'REVIEW', outcome: 'APPROVE', approverSubjectId: APPROVER, makerSubjectId: maker });
      if (!decision.ok) throw new Error(`decision failed: ${decision.reason}/${'code' in decision ? decision.code : ''}`);
      await advance(c, caseId, instanceId, rev, 'RESOLVED', APPROVER, 'RESOLVED');
    }

    // Case 2 — mid-flight at REVIEW with a reviewer assigned and an approval
    // decision recorded, awaiting the final resolve.
    {
      const caseId = await makeCase(c, contoso, '[demo] Contract escalation', 'URGENT');
      const { instanceId, revision } = await startCase(c, caseId);
      let rev = await advance(c, caseId, instanceId, revision, 'IN_PROGRESS', MAKER, 'PENDING');
      await assignParticipant(c, { tenantId: TENANT, instanceId, stageKey: 'REVIEW', participantKey: 'reviewer', targetKind: 'USER', targetKey: REVIEWER, assignedBySubjectId: MAKER });
      await advance(c, caseId, instanceId, rev, 'REVIEW', MAKER, 'PENDING');
      const maker = await makerForStage(c, { tenantId: TENANT, instanceId, stageKey: 'REVIEW' });
      const decision = await recordCaseDecision(c, { tenantId: TENANT, instanceId, workTypeKey: 'crm.case', stageKey: 'REVIEW', outcome: 'APPROVE', approverSubjectId: APPROVER, makerSubjectId: maker });
      if (!decision.ok) throw new Error(`decision failed: ${decision.reason}`);
    }

    // Case 3 — freshly intook, no account (shows an entry-condition-blocked path).
    {
      const caseId = await makeCase(c, fabrikam, '[demo] New support intake', 'NORMAL');
      await startCase(c, caseId);
    }

    // A tenant blueprint DRAFT so the authoring surface has something to publish.
    await createTenantDraftFromPlatform(c, { tenantId: TENANT, blueprintKey: 'crm.case', label: 'Demo case lifecycle' });

    return 'seeded';
}

async function main(): Promise<void> {
  const pool = makePool();
  const c = await pool.connect();
  try {
    const outcome = await seedDemo(c);
    if (outcome === 'skipped') {
      console.log('Demo data already present — nothing to do.');
      return;
    }
    console.log('Seeded demo Decision Fabric dataset:');
    console.log('  • 3 accounts (2 with ACTIVE agreements), contacts, a 5,000,000 approval grant');
    console.log('  • case 1 resolved (COMPLETED), case 2 at REVIEW post-decision, case 3 fresh intake');
    console.log('  • 1 tenant blueprint draft ready to publish');
  } finally {
    c.release();
    await pool.end();
  }
}

// Run as a script (not when imported by the harness).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('seed-demo failed:', error);
    process.exit(1);
  });
}
