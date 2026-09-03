import { NextResponse } from 'next/server';
import { QUALIFICATION_RESPONSES, type QualificationResponse } from '../../../../../../lib/lead-scoring-domain';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || /[\0\r]/u.test(text)) return null;
  return text;
}

function parseQualificationRequest(body: Record<string, unknown>) {
  const hasTemplateKey = Object.prototype.hasOwnProperty.call(body, 'templateKey');
  const templateKey = hasTemplateKey ? boundedString(body.templateKey, 120) : 'default';
  if (!templateKey) throw new Error('templateKey must be a non-empty string of at most 120 characters.');
  if (!Array.isArray(body.assessments) || body.assessments.length === 0 || body.assessments.length > 100) {
    throw new Error('At least one qualification assessment is required.');
  }
  const supplied = body.assessments.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Assessment ${index + 1} must be an object.`);
    const record = entry as Record<string, unknown>;
    const criterionKey = boundedString(record.criterionKey, 120);
    const response = typeof record.response === 'string' ? record.response.trim().toUpperCase() : '';
    const note = record.note == null || record.note === '' ? null : boundedString(record.note, 2000);
    if (!criterionKey || !(QUALIFICATION_RESPONSES as readonly string[]).includes(response) || (record.note != null && record.note !== '' && !note)) {
      throw new Error(`Assessment ${index + 1} has invalid criterion, response or note.`);
    }
    return { criterionKey, response: response as QualificationResponse, note };
  });
  if (new Set(supplied.map((item) => item.criterionKey)).size !== supplied.length) {
    throw new Error('Each criterion may be assessed at most once per request.');
  }
  return { templateKey, supplied };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const captureLeadId = decodeURIComponent((await params).id).trim();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'Invalid capture Lead identifier.' }, { status: 400 });
    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'lead-management' });
      if (module?.availability !== 'ACTIVE') return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      const lead = await client.query(`SELECT organization_id FROM platform.lead_capture_leads WHERE tenant_id=$1::uuid AND capture_lead_id=$2::uuid`, [context.tenantId, captureLeadId]);
      if (!lead.rows[0]) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });
      const result = await client.query(
        `SELECT qualification_id, qualification_template_id, template_version,
                criterion_key, response, note, assessed_by_subject_id, assessed_at
           FROM platform.lead_qualifications
          WHERE tenant_id=$1::uuid AND capture_lead_id=$2::uuid
          ORDER BY assessed_at DESC, qualification_id DESC`,
        [context.tenantId, captureLeadId],
      );
      return NextResponse.json({ captureLeadId, assessments: result.rows });
    });
  } catch (error) {
    console.error('Brand qualification assessment read failed:', error);
    return NextResponse.json({ error: 'Unable to load qualification assessments.' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const captureLeadId = decodeURIComponent((await params).id).trim();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    if (!UUID.test(captureLeadId)) return NextResponse.json({ error: 'Invalid capture Lead identifier.' }, { status: 400 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    let parsed: ReturnType<typeof parseQualificationRequest>;
    try {
      parsed = parseQualificationRequest(body);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid qualification request.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'lead-management' });
      if (module?.availability !== 'ACTIVE') return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      const leadResult = await client.query<{ organization_id: string }>(
        `SELECT organization_id FROM platform.lead_capture_leads WHERE tenant_id=$1::uuid AND capture_lead_id=$2::uuid FOR UPDATE`,
        [context.tenantId, captureLeadId],
      );
      const lead = leadResult.rows[0];
      if (!lead) return NextResponse.json({ error: 'Demand Capture Lead not found.' }, { status: 404 });
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, lead.organization_id)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      const templateResult = await client.query<{
        qualification_template_id: string;
        version: number;
        criteria: Array<{ key?: unknown }>;
      }>(
        `SELECT qualification_template_id, version, criteria
           FROM platform.lead_qualification_templates
          WHERE tenant_id=$1::uuid AND organization_id=$2::uuid
            AND template_key=$3 AND status='ACTIVE' LIMIT 1`,
        [context.tenantId, lead.organization_id, parsed.templateKey],
      );
      const template = templateResult.rows[0];
      if (!template) {
        return NextResponse.json({ denied: true, reasonKey: 'QUALIFICATION_TEMPLATE_NOT_ACTIVE', message: 'No active qualification template exists for this key.' }, { status: 409 });
      }
      const allowedCriteria = new Set((Array.isArray(template.criteria) ? template.criteria : [])
        .map((criterion) => typeof criterion?.key === 'string' ? criterion.key : '')
        .filter(Boolean));
      const unknown = parsed.supplied.find((item) => !allowedCriteria.has(item.criterionKey));
      if (unknown) return NextResponse.json({ error: `Unknown qualification criterion: ${unknown.criterionKey}.` }, { status: 400 });

      const inserted = [];
      for (const assessment of parsed.supplied) {
        const result = await client.query<{ qualification_id: string; assessed_at: Date | string }>(
          `INSERT INTO platform.lead_qualifications (
             tenant_id, organization_id, capture_lead_id, qualification_template_id,
             template_version, criterion_key, response, note, assessed_by_subject_id
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9)
           RETURNING qualification_id, assessed_at`,
          [context.tenantId, lead.organization_id, captureLeadId, template.qualification_template_id, template.version, assessment.criterionKey, assessment.response, assessment.note, context.subjectId],
        );
        inserted.push({
          qualificationId: result.rows[0]?.qualification_id,
          criterionKey: assessment.criterionKey,
          response: assessment.response,
          assessedAt: result.rows[0]?.assessed_at ? new Date(result.rows[0].assessed_at).toISOString() : null,
        });
      }
      return NextResponse.json({ success: true, captureLeadId, assessments: inserted }, { status: 201 });
    });
  } catch (error) {
    console.error('Brand qualification assessment create failed:', error);
    return NextResponse.json({ error: 'Unable to record qualification assessments.' }, { status: 500 });
  }
}
