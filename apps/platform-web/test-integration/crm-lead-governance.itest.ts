import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { leadTransitionEntryHash } from '../lib/crm-lead-transition.ts';

// Gate 4 DB-invariant proof: the transition ledger is append-only, an OVERRIDE
// without a reason is rejected, and the revision chain has no forks. Runs as
// superuser to focus on the constraints (org-auth RLS is proven elsewhere).

function connectInfo() {
  return { host: process.env.PGHOST ?? 'localhost', port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE ?? 'expadio_test' };
}
const superuserPool = () => new pg.Pool({ ...connectInfo(), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres', max: 1 });

async function seedLead(c: pg.PoolClient) {
  const tenantId = randomUUID();
  const organizationId = randomUUID();
  const leadId = randomUUID();
  await c.query(`INSERT INTO platform.organizations (organization_id, tenant_id, parent_organization_id, name) VALUES ($1,$2,NULL,'Gov Org')`, [organizationId, tenantId]);
  await c.query(
    `INSERT INTO platform.crm_leads (lead_id, tenant_id, organization_id, title, stage, currency, source, raw_payload)
     VALUES ($1,$2,$3,'Lead','NEW','USD','manual','{}'::jsonb)`,
    [leadId, tenantId, organizationId],
  );
  return { tenantId, organizationId, leadId };
}

async function insertTransition(c: pg.PoolClient, s: { tenantId: string; organizationId: string; leadId: string }, o: {
  fromStage: string; toStage: string; kind: string; reason: string | null; fromRevision: number; toRevision: number; prevHash: string | null;
}) {
  const occurredAt = new Date().toISOString();
  const entryHash = leadTransitionEntryHash({
    prevHash: o.prevHash, leadId: s.leadId, fromStage: o.fromStage, toStage: o.toStage,
    transitionKind: o.kind, reason: o.reason, actorSubjectId: 'user:test', toRevision: o.toRevision, occurredAt,
  });
  await c.query(
    `INSERT INTO platform.crm_lead_stage_transitions
       (tenant_id, organization_id, lead_id, from_stage, to_stage, transition_kind, reason,
        actor_subject_id, from_revision, to_revision, prev_hash, entry_hash, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'user:test',$8,$9,$10,$11,$12)`,
    [s.tenantId, s.organizationId, s.leadId, o.fromStage, o.toStage, o.kind, o.reason, o.fromRevision, o.toRevision, o.prevHash, entryHash, occurredAt],
  );
  return entryHash;
}

async function expectReject(fn: () => Promise<unknown>, needle: RegExp) {
  try { await fn(); assert.fail('expected rejection'); }
  catch (e) { if (e instanceof assert.AssertionError) throw e; assert.match(String((e as { message?: string }).message ?? e), needle); }
}

test('transition ledger chains revisions, refuses reasonless OVERRIDE, and is append-only', async () => {
  const pool = superuserPool();
  const c = await pool.connect();
  try {
    const s = await seedLead(c);
    const h1 = await insertTransition(c, s, { fromStage: 'NEW', toStage: 'QUALIFIED', kind: 'STANDARD', reason: null, fromRevision: 1, toRevision: 2, prevHash: null });
    const h2 = await insertTransition(c, s, { fromStage: 'QUALIFIED', toStage: 'NEW', kind: 'OVERRIDE', reason: 'reopened after error', fromRevision: 2, toRevision: 3, prevHash: h1 });
    assert.ok(h2 && h2 !== h1);

    // OVERRIDE without a reason is refused by the CHECK.
    await expectReject(
      () => insertTransition(c, s, { fromStage: 'NEW', toStage: 'WON', kind: 'OVERRIDE', reason: null, fromRevision: 3, toRevision: 4, prevHash: h2 }),
      /crm_lead_transition_reason|violates check/i,
    );

    // No fork: reusing a to_revision is rejected.
    await expectReject(
      () => insertTransition(c, s, { fromStage: 'NEW', toStage: 'PROPOSAL', kind: 'OVERRIDE', reason: 'x', fromRevision: 2, toRevision: 3, prevHash: h1 }),
      /duplicate key|to_revision/i,
    );

    // Append-only: history cannot be edited or deleted.
    await expectReject(() => c.query(`UPDATE platform.crm_lead_stage_transitions SET reason='tampered' WHERE lead_id=$1::uuid`, [s.leadId]), /append-only/);
    await expectReject(() => c.query(`DELETE FROM platform.crm_lead_stage_transitions WHERE lead_id=$1::uuid`, [s.leadId]), /append-only/);
  } finally {
    c.release();
    await pool.end();
  }
});
