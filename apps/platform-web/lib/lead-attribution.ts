/**
 * Capture-time attribution + consent persistence (Gate 2).
 *
 * Turns the submission's attribution/consent (already normalized by
 * @expadio/lead-capture) into durable, queryable evidence: an append-only
 * attribution touch and append-only consent records, plus first-/latest-touch
 * maintenance on the person. Runs in the capture ingress transaction under the
 * request source context. Best-effort — the caller must never fail a capture over
 * attribution work.
 */
import type { CaptureAttribution, CaptureConsent } from '@expadio/lead-capture';

export interface AttributionClient {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

const A = (v: string | undefined | null) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Flatten an attribution object to the ordered column values inserted. Pure. */
export function attributionColumns(attribution: CaptureAttribution): (string | null)[] {
  return [
    A(attribution.pageUrl), A(attribution.referrerUrl),
    A(attribution.utmSource), A(attribution.utmMedium), A(attribution.utmCampaign),
    A(attribution.utmTerm), A(attribution.utmContent), A(attribution.utmId),
    A(attribution.gclid), A(attribution.fbclid),
    A(attribution.referralCode), A(attribution.affiliateKey),
  ];
}

export async function persistCaptureAttributionAndConsent(
  client: AttributionClient,
  input: {
    readonly tenantId: string;
    readonly organizationId: string;
    readonly captureLeadId: string;
    readonly contactId: string | null;
    readonly sourceKey: string;
    readonly attribution: CaptureAttribution;
    readonly consent: readonly CaptureConsent[];
    readonly occurredAt?: string;
  },
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();

  await client.query(
    `INSERT INTO platform.lead_attribution_events
       (tenant_id, organization_id, contact_id, capture_lead_id, source_key,
        page_url, referrer_url, utm_source, utm_medium, utm_campaign, utm_term,
        utm_content, utm_id, gclid, fbclid, referral_code, affiliate_key, occurred_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      input.tenantId, input.organizationId, input.contactId, input.captureLeadId, input.sourceKey,
      ...attributionColumns(input.attribution), occurredAt,
    ],
  );

  for (const consent of input.consent) {
    await client.query(
      `INSERT INTO platform.lead_consent_records
         (tenant_id, organization_id, contact_id, capture_lead_id, channel, purpose, granted, text_version, occurred_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9)`,
      [input.tenantId, input.organizationId, input.contactId, input.captureLeadId,
       consent.channel, consent.purpose, consent.granted, A(consent.textVersion), occurredAt],
    );
  }

  // First-touch is set once; latest-touch always advances.
  if (input.contactId) {
    await client.query(
      `UPDATE platform.lead_contacts
          SET first_touch_at = COALESCE(first_touch_at, $4::timestamptz),
              first_source_key = COALESCE(first_source_key, $5),
              last_touch_at = $4::timestamptz,
              last_source_key = $5,
              updated_at = now()
        WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND contact_id = $3::uuid`,
      [input.tenantId, input.organizationId, input.contactId, occurredAt, input.sourceKey],
    );
  }
}
