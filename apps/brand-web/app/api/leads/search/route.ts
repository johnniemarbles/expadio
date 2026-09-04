import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leads/search?email=&phone=&name=
 *
 * Pre-creation duplicate search. Returns up to 5 existing leads in this
 * organization that match on email (exact, case-insensitive), phone (exact),
 * or contact name (trigram-style ILIKE). Used by CreateLeadForm to surface
 * possible duplicates before the user submits.
 */
export async function GET(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email')?.trim().toLowerCase() ?? '';
    const phone = searchParams.get('phone')?.trim() ?? '';
    const name = searchParams.get('name')?.trim() ?? '';

    if (!email && !phone && !name) {
      return NextResponse.json({ leads: [] });
    }

    return await withBrandTransaction(context, async (client) => {
      const conditions: string[] = [];
      const values: unknown[] = [context.tenantId, context.organizationId];
      let idx = 3;

      if (email) {
        conditions.push(`LOWER(l.contact_email) = $${idx}`);
        values.push(email);
        idx++;
      }
      if (phone) {
        // Normalise: strip non-digit characters for comparison
        conditions.push(`regexp_replace(l.contact_phone, '[^0-9]', '', 'g') = regexp_replace($${idx}, '[^0-9]', '', 'g')`);
        values.push(phone);
        idx++;
      }
      if (name && name.length >= 2) {
        conditions.push(`l.contact_name ILIKE $${idx}`);
        values.push(`%${name}%`);
        idx++;
      }

      if (conditions.length === 0) {
        return NextResponse.json({ leads: [] });
      }

      const result = await client.query(
        `SELECT l.lead_id, l.contact_name, l.first_name, l.last_name,
                l.contact_email, l.contact_phone, l.stage,
                l.enquiry_interest_type, l.enquiry_opportunity_type,
                l.country_code, l.city,
                l.created_at
           FROM platform.crm_leads l
          WHERE l.tenant_id = $1::uuid
            AND l.organization_id = $2::uuid
            AND (${conditions.join(' OR ')})
          ORDER BY l.created_at DESC
          LIMIT 5`,
        values,
      );

      return NextResponse.json({
        leads: result.rows.map((r) => ({
          leadId: r.lead_id,
          displayName: r.first_name && r.last_name
            ? `${r.first_name} ${r.last_name}`
            : (r.contact_name ?? '—'),
          email: r.contact_email ?? null,
          phone: r.contact_phone ?? null,
          stage: r.stage,
          interestType: r.enquiry_interest_type ?? null,
          opportunityType: r.enquiry_opportunity_type ?? null,
          countryCode: r.country_code ?? null,
          city: r.city ?? null,
          createdAt: new Date(r.created_at).toISOString(),
        })),
      });
    });
  } catch (error) {
    console.error('Lead search failed:', error);
    return NextResponse.json({ error: 'Search failed.' }, { status: 500 });
  }
}
