import { NextResponse } from 'next/server';
import { LeadValidationError } from '@expadio/lead';
import { ContextDenied, resolveRequestContext, withTenantTransaction, deniedResponse } from '../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../lib/crm-authz';
import {
  CaptureScopeRejected,
  UPSERT_CAPTURE_CRM_LEAD_SQL,
  buildTrustedCaptureConvertWrite,
  captureConvertBindParams,
  captureLeadIdFromConvertBody,
  loadTrustedCaptureProjection,
  toCaptureCrmLead,
} from '../../../../../lib/lead-capture-convert';

/**
 * Project one persisted Demand Capture lead onto platform.crm_leads.
 * The request supplies only captureLeadId. Stage, payload, organization, owner and
 * layer provenance are loaded from trusted persisted capture state under RLS.
 * Does not replace POST /api/crm/leads/:id/convert (customer funnel) and never
 * deletes the 19-stage capture record (I8).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      throw new ContextDenied('ORGANIZATION_CONTEXT_REQUIRED', 'Select an organization workspace to convert a capture lead.', 403);
    }
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    let captureLeadId: string;
    try {
      captureLeadId = captureLeadIdFromConvertBody(body);
    } catch (error) {
      if (error instanceof CaptureScopeRejected || error instanceof LeadValidationError) {
        return NextResponse.json(
          { error: error.message, field: 'field' in error ? error.field : undefined },
          { status: 400 },
        );
      }
      throw error;
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }

      const projectionResult = await loadTrustedCaptureProjection(client, {
        tenantId: context.tenantId,
        captureLeadId,
      });
      if (projectionResult.kind === 'not_found') return { captureNotFound: true } as const;
      if (projectionResult.kind === 'verification_required') return { verificationRequired: true } as const;

      const write = buildTrustedCaptureConvertWrite(projectionResult, context);
      try {
        const upserted = await client.query(
          UPSERT_CAPTURE_CRM_LEAD_SQL,
          captureConvertBindParams(
            write.principal.tenantId,
            write.organizationId,
            write.ownerSubjectId,
            write.input,
          ),
        );
        const row = upserted.rows[0];
        return {
          lead: toCaptureCrmLead(row),
          alreadyConverted: row.inserted === false,
          capturePreserved: true as const,
          deleteCapture: false as const,
        };
      } catch (err: unknown) {
        const code = typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
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
    if ('captureNotFound' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'CAPTURE_LEAD_NOT_FOUND', message: 'The capture lead is not visible in this organization workspace.' },
        { status: 404 },
      );
    }
    if ('verificationRequired' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'VERIFICATION_REQUIRED', message: 'The capture lead must be OTP-verified before it can enter the CRM pipeline.' },
        { status: 422 },
      );
    }
    if ('badRef' in result) {
      return NextResponse.json({ error: 'The trusted capture projection contains an invalid linked reference.' }, { status: 400 });
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
