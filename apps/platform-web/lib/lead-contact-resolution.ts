/**
 * Capture-time identity resolution (Gate 1).
 *
 * Runs inside the capture ingress transaction under the request-scoped source
 * GUC. Exact normalized-email → link to the existing active contact (or create
 * one). Non-exact signals (phone/name) never merge here; they are enqueued into
 * the review queue for a human. The domain rules live in @expadio/lead-identity;
 * this module is only the SQL wrapper.
 */
import { randomUUID } from 'node:crypto';
import {
  classifyMatch,
  normalizeEmailKey,
  normalizeNameKey,
  normalizePhoneKey,
  type ContactIdentity,
} from '@expadio/lead-identity';

export interface CaptureContactClient {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export interface ResolveContactInput {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly phone?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
}

export interface ResolvedContact {
  readonly contactId: string;
  readonly created: boolean;
  readonly candidateCount: number;
}

interface ActiveContactRow {
  contact_id: string;
  email_key: string | null;
  phone_key: string | null;
  name_key: string | null;
}

/**
 * Resolve or create the person for a capture, and enqueue review candidates.
 * Best-effort on the candidate step: a duplicate-pair race is swallowed (the
 * unique index makes enqueue idempotent). Throws only on an invalid email, which
 * the caller has already validated via the submission contract.
 */
export async function resolveOrCreateLeadContact(
  client: CaptureContactClient,
  input: ResolveContactInput,
): Promise<ResolvedContact> {
  const emailKey = normalizeEmailKey(input.email);
  const phoneKey = normalizePhoneKey(input.phone ?? null);
  const nameKey = normalizeNameKey(input.firstName ?? null, input.lastName ?? null);

  // Exact-email AUTO_LINK: reuse the existing active contact.
  const existing = await client.query<{ contact_id: string }>(
    `SELECT contact_id FROM platform.lead_contacts
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND email_key = $3 AND status = 'ACTIVE'
      LIMIT 1`,
    [input.tenantId, input.organizationId, emailKey],
  );
  if (existing.rows[0]) {
    return { contactId: existing.rows[0].contact_id, created: false, candidateCount: 0 };
  }

  const contactId = randomUUID();
  await client.query(
    `INSERT INTO platform.lead_contacts
       (contact_id, tenant_id, organization_id, email, email_key, phone, phone_key, first_name, last_name, name_key)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10)`,
    [contactId, input.tenantId, input.organizationId,
     input.email.trim(), emailKey,
     input.phone?.trim() || null, phoneKey,
     input.firstName?.trim() || null, input.lastName?.trim() || null, nameKey],
  );

  // Candidate detection: other active contacts sharing a phone or name key.
  let candidateCount = 0;
  if (phoneKey || nameKey) {
    const others = await client.query<ActiveContactRow>(
      `SELECT contact_id, email_key, phone_key, name_key
         FROM platform.lead_contacts
        WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND status = 'ACTIVE'
          AND contact_id <> $3::uuid
          AND ((phone_key IS NOT NULL AND phone_key = $4) OR (name_key IS NOT NULL AND name_key = $5))
        LIMIT 25`,
      [input.tenantId, input.organizationId, contactId, phoneKey, nameKey],
    );
    const self: ContactIdentity = { emailKey, phoneKey, nameKey };
    for (const other of others.rows) {
      const result = classifyMatch(self, { emailKey: other.email_key, phoneKey: other.phone_key, nameKey: other.name_key });
      if (result.decision !== 'REVIEW') continue;
      await client.query(
        `INSERT INTO platform.lead_contact_duplicate_candidates
           (tenant_id, organization_id, contact_id, match_contact_id, confidence, signals)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::jsonb)
         ON CONFLICT (tenant_id, organization_id, contact_id, match_contact_id) DO NOTHING`,
        [input.tenantId, input.organizationId, contactId, other.contact_id, result.confidence, JSON.stringify(result.signals)],
      );
      candidateCount += 1;
    }
  }

  return { contactId, created: true, candidateCount };
}
