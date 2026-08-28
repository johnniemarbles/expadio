import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { recordCaseDecision } from '../lib/workflow-runtime.ts';

/**
 * Separation of duties fails closed: when the maker (who advanced the subject
 * into the stage) is unknown, recordCaseDecision must deny rather than let the
 * four-eyes check pass against an empty requester. The guard returns before any
 * persistence, so no seeded instance is required.
 */

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 1,
  });
}

test('a decision with an unknown maker is denied (SoD fails closed)', async () => {
  const p = pool();
  const c = await p.connect();
  try {
    const result = await recordCaseDecision(c, {
      tenantId: randomUUID(),
      instanceId: randomUUID(),
      workTypeKey: 'crm.case',
      stageKey: 'REVIEW',
      outcome: 'APPROVE',
      approverSubjectId: 'approver',
      makerSubjectId: null,
    });
    assert.ok(result.ok === false && result.reason === 'AUTHORITY_DENIED' && result.code === 'WORKFLOW_SOD_MAKER_UNKNOWN');
  } finally {
    c.release();
    await p.end();
  }
});
