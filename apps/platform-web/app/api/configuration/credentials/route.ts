import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });
  
  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const result = await dbPool.query(
      `SELECT event_id as rotation_id, connector_key as credential_name, event_type as status, occurred_at as rotated_at, request_id as correlation_id
       FROM platform.credential_rotation_events
       WHERE tenant_id = $1
       ORDER BY occurred_at DESC LIMIT 50`,
      [effectiveContext.tenantId]
    );
    
    return NextResponse.json(result.rows);
  } catch (err: any) {
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true }, { status: 401 });
  
  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );
    
    const body = await request.json();
    const { connector_key } = body;
    if (!connector_key) return NextResponse.json({ error: 'connector_key required' }, { status: 400 });

    const crypto = require('crypto');
    let replacementRef = 'provider-secret://staged';

    // Extract and validate credentials
    if (connector_key.startsWith('twilio')) {
      const { accountSid, authToken } = body;
      if (!accountSid || !authToken) {
        return NextResponse.json({ error: 'Account SID and Auth Token required for Twilio' }, { status: 400 });
      }
      const tokenHash = crypto.createHash('sha256').update(authToken).digest('hex').slice(0, 16);
      replacementRef = `provider-secret://${connector_key}/${accountSid}/${tokenHash}`;
    } else if (connector_key === 'resend-email-v1') {
      const { apiKey } = body;
      if (!apiKey) {
        return NextResponse.json({ error: 'API Key required for Resend' }, { status: 400 });
      }
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
      replacementRef = `provider-secret://${connector_key}/${keyHash}`;
    }

    const result = await dbPool.query(
      `INSERT INTO platform.credential_rotation_events 
       (event_id, rotation_reference, sequence, request_id, tenant_id, requested_by_subject_id, connector_key, 
        current_credential_reference, replacement_credential_reference, event_type, 
        authorization_decision_id, reason, occurred_at, correlation_id, evidence_refs)
       VALUES ($1, $2, 1, $3, $4, $5, $6, 'provider-secret://current', $7, 'STAGED', $8, $9, NOW(), $10, $11)
       RETURNING event_id`,
      [
        crypto.randomUUID(), 
        crypto.randomUUID(), 
        crypto.randomUUID(), 
        effectiveContext.tenantId, 
        userId, 
        connector_key,
        replacementRef,
        'decision-auth-' + crypto.randomUUID().slice(0, 8),
        `Rotate provider keys for ${connector_key}`,
        crypto.randomUUID(),
        ['audit:credentials-rotation']
      ]
    );

    return NextResponse.json({ success: true, rotation_id: result.rows[0].event_id });
  } catch (err: any) {
    console.error("Credentials POST Error:", err);
    return NextResponse.json({ denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  }
}
