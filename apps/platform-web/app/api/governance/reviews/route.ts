import { NextResponse } from 'next/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { deniedResponse, resolveRequestContext } from '../../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);
    const result = await dbPool.query(
      `SELECT * FROM platform.company_brain_correction_proposals 
       WHERE tenant_id = $1 AND status = 'UNREVIEWED'
       ORDER BY created_at DESC LIMIT 50`,
      [effectiveContext.tenantId]
    );

    const reviews = result.rows.map((row: any) => ({
      id: row.proposal_id,
      title: 'Review Correction Proposal',
      category: 'Company Brain',
      requestedBy: row.proposed_by_subject_id || 'System',
      age: row.created_at,
      risk: 'Medium'
    }));

    return NextResponse.json(reviews);
  } catch (error: any) {
    console.error("Governance Reviews API Error:", error);
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function POST(request: Request) {
  try {
    const effectiveContext = await resolveRequestContext(request);

    const body = await request.json();
    const { id, action } = body;
    
    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 });
    }

    // platform.company_brain_correction_proposals is an IMMUTABLE, append-only ledger of proposals.
    // Resolution state (APPROVED/REJECTED) requires the phase 3 DB schema (e.g. company_brain_correction_decisions).
    // For now, we simulate a successful UI mutation and log an event.

    await dbPool.query(
      `INSERT INTO platform.agent_run_events (tenant_id, event_type, event_reference, actor_subject_id, reason, occurred_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [effectiveContext.tenantId, 'REVIEW_DECISION_SIMULATED', id, effectiveContext.subjectId, `Simulated ${action} of correction proposal`]
    );

    return NextResponse.json({ success: true, id, status: action.toUpperCase(), simulated: true });
  } catch (error: any) {
    console.error("Governance Reviews POST API Error:", error);
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

