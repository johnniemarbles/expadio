import { NextResponse } from 'next/server';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || /[\0\r]/u.test(text)) return null;
  return text;
}

function criteria(value: unknown): Array<{ key: string; label: string | null }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error('At least one qualification criterion is required.');
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Criterion ${index + 1} must be an object.`);
    }
    const key = boundedString((entry as Record<string, unknown>).key, 120);
    const rawLabel = (entry as Record<string, unknown>).label;
    const label = rawLabel == null || rawLabel === '' ? null : boundedString(rawLabel, 240);
    if (!key || (rawLabel != null && rawLabel !== '' && !label)) {
      throw new Error(`Criterion ${index + 1} has invalid key or label.`);
    }
    if (seen.has(key)) throw new Error(`Duplicate qualification criterion key: ${key}.`);
    seen.add(key);
    return { key, label };
  });
}

async function governance(client: any, context: Awaited<ReturnType<typeof resolveBrandContext>>) {
  const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'lead-management' });
  if (module?.availability !== 'ACTIVE') {
    return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
  }
  if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
    return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    return await withBrandTransaction(context, async (client) => {
      const denied = await governance(client, context); if (denied) return denied;
      const result = await client.query(
        `SELECT qualification_template_id, template_key, name, version, criteria,
                status, created_at, activated_at, retired_at
           FROM platform.lead_qualification_templates
          WHERE tenant_id=$1::uuid AND organization_id=$2::uuid
          ORDER BY template_key ASC, version DESC`,
        [context.tenantId, context.organizationId],
      );
      return NextResponse.json({ organizationId: context.organizationId, templates: result.rows });
    });
  } catch (error) {
    console.error('Brand qualification template read failed:', error);
    return NextResponse.json({ error: 'Unable to load qualification templates.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const templateKey = boundedString(body.templateKey, 120);
    const name = boundedString(body.name, 180);
    const version = Number(body.version);
    let normalizedCriteria;
    try { normalizedCriteria = criteria(body.criteria); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid criteria.' }, { status: 400 }); }
    if (!templateKey || !name || !Number.isInteger(version) || version <= 0) {
      return NextResponse.json({ error: 'templateKey, name and a positive integer version are required.' }, { status: 400 });
    }
    return await withBrandTransaction(context, async (client) => {
      const denied = await governance(client, context); if (denied) return denied;
      try {
        const inserted = await client.query<{ qualification_template_id: string }>(
          `INSERT INTO platform.lead_qualification_templates (
             tenant_id, organization_id, template_key, name, version, criteria,
             status, created_by_subject_id
           ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,'DRAFT',$7)
           RETURNING qualification_template_id`,
          [context.tenantId, context.organizationId, templateKey, name, version, JSON.stringify(normalizedCriteria), context.subjectId],
        );
        return NextResponse.json({ success: true, qualificationTemplateId: inserted.rows[0]?.qualification_template_id, status: 'DRAFT' }, { status: 201 });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return NextResponse.json({ denied: true, reasonKey: 'QUALIFICATION_TEMPLATE_VERSION_CONFLICT', message: 'That qualification template version already exists.' }, { status: 409 });
        }
        throw error;
      }
    });
  } catch (error) {
    console.error('Brand qualification template create failed:', error);
    return NextResponse.json({ error: 'Unable to create qualification template.' }, { status: 500 });
  }
}
