import { NextResponse } from 'next/server';
import { LeadValidationError } from '@expadio/lead';
import { resolveRequestContext, withTenantTransaction, deniedResponse } from '../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../lib/crm-authz';
import {
  CaptureScopeRejected,
  UPSERT_CAPTURE_CRM_LEAD_SQL,
  buildCaptureConvertWrite,
  captureConvertBindParams,
  toCaptureCrmLead,
} from '../../../../../lib/lead-capture-convert';

/**
 * Project an inbound capture snapshot onto platform.crm_leads.
 * Does not replace POST /api/crm/leads/:id/convert (customer funnel).
 * Does not delete extract capture history (I8).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    let write;
    try {
      write = buildCaptureConvertWrite(body, context);
    } catch (error) {
      if (error instanceof CaptureScopeRejected) {
        return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
      }
      if (error instanceof LeadValidationError) {
        return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
      }
      throw error;
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      try {
        const upserted = await client.query(UPSERT_CAPTURE_CRM_LEAD_SQL, captureConvertBindParams(
          write.principal.tenantId,
          context.subjectId,
          write.input,
        ));
        const row = upserted.rows[0];
        return {
          lead: toCaptureCrmLead(row),
          alreadyConverted: row.inserted === false,
          capturePreserved: true as const,
          deleteCapture: false as const,
        };
      } catch (err: unknown) {
        const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: string }).code) : '';
        if (code === '23503') return { badRef: true } as const;
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to convert capture leads.' },
        { status: 403 },
      );
    }
    if ('badRef' in result) {
      return NextResponse.json({ error: 'The linked account or contact does not exist in this workspace.' }, { status: 400 });
    }
    return NextResponse.json(
      {
        success: true,
        lead: result.lead,
        alreadyConverted: result.alreadyConverted,
        capturePreserved: result.capturePreserved,
        deleteCapture: result.deleteCapture,
      },
      { status: result.alreadyConverted ? 200 : 201 },
    );
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
