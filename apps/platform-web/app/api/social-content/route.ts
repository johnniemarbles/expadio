import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../lib/governance-authz';

/**
 * Social content items — fifth governed vertical (social.content_publish).
 * Tenant-scoped via RLS; reads require membership, writes require a governing role.
 * Workflow is started via /api/social-content/[id]/workflow.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toRow(row: any) {
  return {
    contentItemId: row.content_item_id,
    title: row.title ?? null,
    body: row.body,
    mediaUrls: row.media_urls ?? [],
    platforms: row.platforms ?? [],
    source: row.source,
    status: row.status,
    authorSubjectId: row.author_subject_id ?? null,
    blueprintKey: row.blueprint_key ?? null,
    workflowInstanceId: row.workflow_instance_id ?? null,
    stageKey: row.stage_key ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const rows = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT content_item_id, title, body, media_urls, platforms, source, status,
                author_subject_id, blueprint_key, workflow_instance_id, stage_key, created_at
           FROM platform.social_content_items
          ORDER BY created_at DESC
          LIMIT 200`,
      );
      return result.rows.map(toRow);
    });
    return NextResponse.json(rows);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (text === '') {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }
    const platforms = Array.isArray(body?.platforms) ? body.platforms : [];
    const mediaUrls = Array.isArray(body?.mediaUrls) ? body.mediaUrls : [];
    const title =
      typeof body?.title === 'string' && body.title.trim() !== '' ? body.title.trim() : null;
    const source = body?.source === 'ai_generated' ? 'ai_generated' : 'manual';

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      await client.query('BEGIN');
      try {
        await context.applyTo(client);
        const inserted = await client.query(
          `INSERT INTO platform.social_content_items
             (tenant_id, author_subject_id, title, body, media_urls, platforms, source, status, blueprint_key)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'DRAFT', 'social.content_publish')
           RETURNING content_item_id`,
          [context.tenantId, context.subjectId, title, text, mediaUrls, platforms, source],
        );
        await client.query('COMMIT');
        return { contentItemId: inserted.rows[0].content_item_id as string } as const;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'You need a tenant admin role to create social content.',
        },
        { status: 403 },
      );
    }
    return NextResponse.json({ success: true, contentItemId: result.contentItemId }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
