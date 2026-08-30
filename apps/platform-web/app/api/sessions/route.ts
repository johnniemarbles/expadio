import { NextResponse } from 'next/server';
import { dbPool } from '../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../lib/request-context';
import crypto from 'node:crypto';

export async function POST(request: Request) {
  try {
    const contextState = await resolveRequestContext(request);

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Ignored if empty or invalid JSON
    }

    const runId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    const createdAt = new Date().toISOString();

    const agentId = body.agentId || 'interactive-session-agent';
    const purpose = body.purpose || 'Interactive Web Session';
    const contextBundleReference = body.contextBundleReference || 'default-context-v1';
    const budgetPolicyReference = body.budgetPolicyReference || 'unlimited-dev-policy';
    const reason = body.reason || 'User initiated session from web platform';
    const evidenceRefs = ['web-ui-initiation'];

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL app.tenant_id = $1', [contextState.tenantId]);

      const query = `
        INSERT INTO platform.agent_runs (
          run_id, tenant_id, agent_id, purpose, context_bundle_reference, 
          budget_policy_reference, idempotency_key, requested_by_subject_id, 
          requested_at, created_at, reason, correlation_id, evidence_refs
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13
        )
        RETURNING run_id
      `;

      const values = [
        runId,
        contextState.tenantId,
        agentId,
        purpose,
        contextBundleReference,
        budgetPolicyReference,
        idempotencyKey,
        contextState.subjectId,
        requestedAt,
        createdAt,
        reason,
        correlationId,
        evidenceRefs
      ];

      const res = await client.query(query, values);
      await client.query('COMMIT');

      const insertedSessionId = res.rows[0].run_id;

      return NextResponse.json({
        sessionId: insertedSessionId,
        status: 'active'
      });
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error("DB Insert Error:", dbError);
      return NextResponse.json({ error: 'Failed to create session in database' }, { status: 500 });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Session API Error:", error);
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
