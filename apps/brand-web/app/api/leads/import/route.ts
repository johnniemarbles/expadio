import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 2000;
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

/** Parse a raw CSV string into rows of named fields. Handles quoted fields and trailing \r. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((col, i) => { row[col] = (cells[i] ?? '').trim(); });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

interface ImportRowResult {
  row: number;
  status: 'created' | 'skipped' | 'error';
  captureLeadId?: string;
  reason?: string;
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });

    const contentType = request.headers.get('content-type') ?? '';
    let csvText: string;

    if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 4 MB limit.' }, { status: 413 });
      csvText = new TextDecoder().decode(buf);
    } else if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) return NextResponse.json({ error: 'A CSV file field named "file" is required.' }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 4 MB limit.' }, { status: 413 });
      csvText = await file.text();
    } else {
      return NextResponse.json({ error: 'Content-Type must be text/csv or multipart/form-data with a "file" field.' }, { status: 415 });
    }

    const rows = parseCsv(csvText);
    if (rows.length === 0) return NextResponse.json({ error: 'The CSV has no data rows.' }, { status: 400 });
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Import is limited to ${MAX_ROWS} rows per request.` }, { status: 400 });

    // Look up the source_id to use for imported leads — the caller may specify a
    // source_key in the CSV header or body; otherwise we expect the import source
    // to be configured per-org.
    const body = await (async () => {
      try { return await request.json(); } catch { return {}; }
    })().catch(() => ({}));
    const sourceKey = typeof (body as Record<string,unknown>).sourceKey === 'string'
      ? (body as Record<string,unknown>).sourceKey as string
      : 'IMPORT';

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      // Resolve the import source.
      const srcResult = await client.query(
        `SELECT source_id FROM platform.lead_capture_sources
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND source_key = $3 AND status = 'ACTIVE'
          LIMIT 1`,
        [context.tenantId, context.organizationId, sourceKey],
      );
      if (srcResult.rowCount === 0) {
        return NextResponse.json({ error: `No active capture source '${sourceKey}' found. Create one with channel=IMPORT first.` }, { status: 422 });
      }
      const sourceId: string = srcResult.rows[0].source_id;

      const results: ImportRowResult[] = [];
      let created = 0;
      let skipped = 0;
      let errors = 0;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const email = (r.email ?? '').trim().toLowerCase();
        const name = (r.name ?? r.full_name ?? '').trim().slice(0, 200);
        const phone = (r.phone ?? r.phone_number ?? '').trim().slice(0, 30);
        const notes = (r.notes ?? r.note ?? '').trim().slice(0, 5000);

        if (!email && !name) {
          results.push({ row: i + 2, status: 'error', reason: 'Row requires at least email or name.' });
          errors++;
          continue;
        }

        try {
          // Idempotency: if a lead already exists for this source + email in this session, skip.
          if (email) {
            const dup = await client.query(
              `SELECT capture_lead_id FROM platform.lead_capture_leads
                WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
                  AND source_id = $3::uuid
                  AND (submission->>'email') = $4
                LIMIT 1`,
              [context.tenantId, context.organizationId, sourceId, email],
            );
            if ((dup.rowCount ?? 0) > 0) {
              results.push({ row: i + 2, status: 'skipped', captureLeadId: dup.rows[0].capture_lead_id, reason: 'Duplicate email for this source.' });
              skipped++;
              continue;
            }
          }

          const submission = JSON.stringify({ email: email || undefined, name: name || undefined, phone: phone || undefined });
          const ins = await client.query(
            `INSERT INTO platform.lead_capture_leads
               (tenant_id, organization_id, source_id, submission, verification_state)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, 'NOT_REQUIRED')
             RETURNING capture_lead_id`,
            [context.tenantId, context.organizationId, sourceId, submission],
          );
          const captureLeadId: string = ins.rows[0].capture_lead_id;

          if (notes) {
            await client.query(
              `INSERT INTO platform.lead_activities
                 (tenant_id, organization_id, capture_lead_id, activity_type, actor_subject_id, body)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'NOTE', $4, $5)`,
              [context.tenantId, context.organizationId, captureLeadId, context.subjectId, notes],
            );
          }

          // Best-effort SYSTEM activity as import marker.
          await client.query(
            `INSERT INTO platform.lead_activities
               (tenant_id, organization_id, capture_lead_id, activity_type, metadata)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'SYSTEM', '{"event":"import"}'::jsonb)`,
            [context.tenantId, context.organizationId, captureLeadId],
          ).catch(() => undefined);

          results.push({ row: i + 2, status: 'created', captureLeadId });
          created++;
        } catch (rowError) {
          console.error(`Import row ${i + 2} failed:`, rowError);
          results.push({ row: i + 2, status: 'error', reason: 'Row processing failed.' });
          errors++;
        }
      }

      return NextResponse.json({ success: true, created, skipped, errors, results }, { status: errors === rows.length ? 422 : 201 });
    });
  } catch (error) {
    console.error('Lead import failed:', error);
    return NextResponse.json({ error: 'Unable to process import.' }, { status: 500 });
  }
}
