/**
 * Duplicate-review + reversible merge service (Gate 1, management side).
 *
 * Operates under the brand transaction (organization-scoped RLS). The domain
 * rules — survivor selection, field-win planning, and the cross-org/self/active
 * invariants — come from @expadio/lead-identity; this module applies them and
 * records reversible evidence. Merges never destroy the duplicate: it is flipped
 * to MERGED pointing at the survivor and can be reactivated.
 */
import type { PoolClient } from 'pg';
import {
  chooseSurvivor,
  normalizeNameKey,
  normalizePhoneKey,
  planContactMerge,
  type MergeableContact,
} from '@expadio/lead-identity';

interface ContactRow {
  contact_id: string;
  tenant_id: string;
  organization_id: string;
  status: 'ACTIVE' | 'MERGED';
  created_at: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
}

function toMergeable(row: ContactRow): MergeableContact {
  return {
    contactId: row.contact_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    email: row.email,
    phone: row.phone,
    firstName: row.first_name,
    lastName: row.last_name,
  };
}

export interface CandidateSummary {
  readonly candidateId: string;
  readonly confidence: number;
  readonly signals: Record<string, unknown>;
  readonly contactId: string;
  readonly matchContactId: string;
  readonly contactEmail: string | null;
  readonly matchEmail: string | null;
  readonly createdAt: string;
}

export async function listDuplicateCandidates(
  client: PoolClient,
  scope: { tenantId: string; organizationId: string },
): Promise<CandidateSummary[]> {
  const result = await client.query(
    `SELECT c.candidate_id, c.confidence, c.signals, c.contact_id, c.match_contact_id, c.created_at,
            a.email AS contact_email, b.email AS match_email
       FROM platform.lead_contact_duplicate_candidates c
       JOIN platform.lead_contacts a ON a.contact_id = c.contact_id AND a.tenant_id = c.tenant_id AND a.organization_id = c.organization_id
       JOIN platform.lead_contacts b ON b.contact_id = c.match_contact_id AND b.tenant_id = c.tenant_id AND b.organization_id = c.organization_id
      WHERE c.tenant_id = $1::uuid AND c.organization_id = $2::uuid AND c.status = 'PENDING'
      ORDER BY c.confidence DESC, c.created_at DESC
      LIMIT 200`,
    [scope.tenantId, scope.organizationId],
  );
  return result.rows.map((row) => ({
    candidateId: row.candidate_id,
    confidence: Number(row.confidence),
    signals: row.signals ?? {},
    contactId: row.contact_id,
    matchContactId: row.match_contact_id,
    contactEmail: row.contact_email,
    matchEmail: row.match_email,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export type ReviewOutcome =
  | { readonly ok: true; readonly mergeId?: string; readonly survivorContactId?: string; readonly mergedContactId?: string }
  | { readonly ok: false; readonly reasonCode: string; readonly reason: string };

export async function dismissCandidate(
  client: PoolClient,
  input: { tenantId: string; organizationId: string; candidateId: string; subjectId: string },
): Promise<ReviewOutcome> {
  const updated = await client.query(
    `UPDATE platform.lead_contact_duplicate_candidates
        SET status = 'DISMISSED', resolved_at = now(), resolved_by_subject_id = $4
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND candidate_id = $3::uuid AND status = 'PENDING'`,
    [input.tenantId, input.organizationId, input.candidateId, input.subjectId],
  );
  if (updated.rowCount !== 1) return { ok: false, reasonCode: 'NOT_PENDING', reason: 'Candidate is not pending.' };
  return { ok: true };
}

/** Confirm a candidate → merge the two contacts (reversibly). */
export async function confirmCandidateMerge(
  client: PoolClient,
  input: { tenantId: string; organizationId: string; candidateId: string; subjectId: string; reason?: string },
): Promise<ReviewOutcome> {
  const candidate = await client.query<{ contact_id: string; match_contact_id: string }>(
    `SELECT contact_id, match_contact_id FROM platform.lead_contact_duplicate_candidates
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND candidate_id = $3::uuid AND status = 'PENDING'
      FOR UPDATE`,
    [input.tenantId, input.organizationId, input.candidateId],
  );
  const pair = candidate.rows[0];
  if (!pair) return { ok: false, reasonCode: 'NOT_PENDING', reason: 'Candidate is not pending.' };

  const contacts = await client.query<ContactRow>(
    `SELECT contact_id, tenant_id, organization_id, status, created_at, email, phone, first_name, last_name
       FROM platform.lead_contacts
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND contact_id = ANY($3::uuid[])
      FOR UPDATE`,
    [input.tenantId, input.organizationId, [pair.contact_id, pair.match_contact_id]],
  );
  if (contacts.rows.length !== 2) return { ok: false, reasonCode: 'CONTACT_MISSING', reason: 'Both contacts must still exist and be in scope.' };

  const [rowA, rowB] = contacts.rows;
  let plan;
  let survivorContactId: string;
  let mergedContactId: string;
  try {
    const { survivor, duplicate } = chooseSurvivor(toMergeable(rowA), toMergeable(rowB));
    plan = planContactMerge(survivor, duplicate);
    survivorContactId = survivor.contactId;
    mergedContactId = duplicate.contactId;
  } catch (error) {
    return { ok: false, reasonCode: (error as { code?: string }).code ?? 'MERGE_INVALID', reason: error instanceof Error ? error.message : 'Merge is not allowed.' };
  }

  // Fill survivor blanks (recomputing match keys for any filled contact fields).
  if (Object.keys(plan.fieldUpdates).length > 0) {
    const u = plan.fieldUpdates;
    await client.query(
      `UPDATE platform.lead_contacts
          SET phone = COALESCE($4, phone),
              phone_key = CASE WHEN $4 IS NULL THEN phone_key ELSE $5 END,
              first_name = COALESCE($6, first_name),
              last_name = COALESCE($7, last_name),
              name_key = CASE WHEN $6 IS NULL AND $7 IS NULL THEN name_key ELSE $8 END,
              updated_at = now()
        WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND contact_id = $3::uuid`,
      [
        input.tenantId, input.organizationId, survivorContactId,
        u.phone ?? null, u.phone ? normalizePhoneKey(u.phone) : null,
        u.firstName ?? null, u.lastName ?? null,
        (u.firstName || u.lastName) ? normalizeNameKey(u.firstName ?? rowA.first_name, u.lastName ?? rowA.last_name) : null,
      ],
    );
  }

  // Relink capture leads to the survivor; retire stale candidate rows for the merged record.
  await client.query(
    `UPDATE platform.lead_capture_leads SET contact_id = $4::uuid, updated_at = now()
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND contact_id = $3::uuid`,
    [input.tenantId, input.organizationId, mergedContactId, survivorContactId],
  );
  await client.query(
    `UPDATE platform.lead_contact_duplicate_candidates
        SET status = 'DISMISSED', resolved_at = now(), resolved_by_subject_id = $4
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND status = 'PENDING'
        AND candidate_id <> $5::uuid
        AND (contact_id = $3::uuid OR match_contact_id = $3::uuid)`,
    [input.tenantId, input.organizationId, mergedContactId, input.subjectId, input.candidateId],
  );

  // Flip the duplicate to MERGED (retained, reversible) and record evidence.
  await client.query(
    `UPDATE platform.lead_contacts
        SET status = 'MERGED', merged_into_contact_id = $4::uuid, updated_at = now()
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND contact_id = $3::uuid AND status = 'ACTIVE'`,
    [input.tenantId, input.organizationId, mergedContactId, survivorContactId],
  );
  const merge = await client.query<{ merge_id: string }>(
    `INSERT INTO platform.lead_contact_merges
       (tenant_id, organization_id, survivor_contact_id, merged_contact_id, reason, performed_by_subject_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6)
     RETURNING merge_id`,
    [input.tenantId, input.organizationId, survivorContactId, mergedContactId, input.reason ?? null, input.subjectId],
  );
  await client.query(
    `UPDATE platform.lead_contact_duplicate_candidates
        SET status = 'CONFIRMED', resolved_at = now(), resolved_by_subject_id = $4
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND candidate_id = $3::uuid`,
    [input.tenantId, input.organizationId, input.candidateId, input.subjectId],
  );

  return { ok: true, mergeId: merge.rows[0].merge_id, survivorContactId, mergedContactId };
}

/** Reverse a merge: reactivate the merged contact. Leads relinked to the survivor
 *  stay put (documented); this restores the person as an independent record. */
export async function reverseContactMerge(
  client: PoolClient,
  input: { tenantId: string; organizationId: string; mergeId: string; subjectId: string },
): Promise<ReviewOutcome> {
  const merge = await client.query<{ merged_contact_id: string; survivor_contact_id: string }>(
    `SELECT merged_contact_id, survivor_contact_id FROM platform.lead_contact_merges
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND merge_id = $3::uuid AND reversed_at IS NULL
      FOR UPDATE`,
    [input.tenantId, input.organizationId, input.mergeId],
  );
  const row = merge.rows[0];
  if (!row) return { ok: false, reasonCode: 'NOT_REVERSIBLE', reason: 'Merge not found or already reversed.' };

  const reactivated = await client.query(
    `UPDATE platform.lead_contacts
        SET status = 'ACTIVE', merged_into_contact_id = NULL, updated_at = now()
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND contact_id = $3::uuid AND status = 'MERGED'`,
    [input.tenantId, input.organizationId, row.merged_contact_id],
  );
  if (reactivated.rowCount !== 1) return { ok: false, reasonCode: 'CONTACT_STATE', reason: 'Merged contact is not in a reversible state.' };

  await client.query(
    `UPDATE platform.lead_contact_merges
        SET reversed_at = now(), reversed_by_subject_id = $4
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND merge_id = $3::uuid`,
    [input.tenantId, input.organizationId, input.mergeId, input.subjectId],
  );
  return { ok: true, survivorContactId: row.survivor_contact_id, mergedContactId: row.merged_contact_id };
}
