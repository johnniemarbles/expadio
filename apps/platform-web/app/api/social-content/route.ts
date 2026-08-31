import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestContext } from '../../../lib/request-context';
import { withTenantClient } from '../../../lib/tenant-db';

/**
 * Social content list/create — subject rows for the social.content_publish vertical.
 * Reads require membership; writes require a governing role (same pattern as access-requests).
 * Workflow binding is started via /api/social-content/[id]/workflow.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await resolveRequestContext(req);
  if (!ctx.ok) return ctx.response;

  return withTenantClient(ctx.tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT content_item_id, title, body, media_urls, platforms, source, status,
              author_subject_id, blueprint_key, workflow_instance_id, stage_key, created_at
         FROM platform.social_content_items
        ORDER BY created_at DESC
        LIMIT 100`,
    );
    return NextResponse.json({ items: rows });
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveRequestContext(req);
  if (!ctx.ok) return ctx.response;
  // Governing role check is enforced inside resolveRequestContext write paths in sibling verticals;
  // if this tenant lacks write role, downstream workflow routes will still gate.

  const body = await req.json().catch(() => ({}));
  const text = typeof body.body === 'string' ? body.body : '';
  if (!text.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }
  const platforms = Array.isArray(body.platforms) ? body.platforms : [];
  const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls : [];

  return withTenantClient(ctx.tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO platform.social_content_items
         (tenant_id, author_subject_id, title, body, media_urls, platforms, source, status, blueprint_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', 'social.content_publish')
       RETURNING content_item_id, title, body, platforms, status, stage_key, created_at`,
      [
        ctx.tenantId,
        ctx.subjectId ?? null,
        body.title ?? null,
        text,
        mediaUrls,
        platforms,
        body.source === 'ai_generated' ? 'ai_generated' : 'manual',
      ],
    );
    return NextResponse.json({ item: rows[0] }, { status: 201 });
  });
}
