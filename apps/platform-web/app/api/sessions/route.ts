import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import {
  ContextDenied,
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../lib/request-context';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      throw new ContextDenied(
        'ORGANIZATION_CONTEXT_REQUIRED',
        'Select an organization workspace to continue.',
        403,
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Empty JSON is allowed; governed defaults below remain explicit.
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

    const insertedSessionId = await withTenantTransaction(context, async (client) => {
      const res = await client.query(
        `INSERT INTO platform.agent_runs (
           run_id, tenant_id, agent_id, purpose, context_bundle_reference,
           budget_policy_reference, idempotency_key, requested_by_subject_id,
           requested_at, created_at, reason, correlation_id, evidence_refs
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, $13
         )
         RETURNING run_id`,
        [
          runId,
          context.tenantId,
          agentId,
          purpose,
          contextBundleReference,
          budgetPolicyReference,
          idempotencyKey,
          context.subjectId,
          requestedAt,
          createdAt,
          reason,
          correlationId,
          evidenceRefs,
        ],
      );
      return res.rows[0].run_id as string;
    });

    return NextResponse.json({
      sessionId: insertedSessionId,
      status: 'active',
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
