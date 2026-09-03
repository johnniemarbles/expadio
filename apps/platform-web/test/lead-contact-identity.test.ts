import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../infra/db/migrations/0137_lead_contact_identity.sql');
const resolution = read('../lib/lead-contact-resolution.ts');
const ingress = read('../app/api/lead-capture/public/[sourceId]/route.ts');

test('migration models org-scoped identity with the safe uniqueness invariant', () => {
  assert.match(migration, /CREATE TABLE platform\.lead_contacts/);
  assert.match(migration, /name_key text/);
  // One ACTIVE contact per normalized email per org makes exact-email link safe.
  assert.match(migration, /lead_contacts_active_email_uq[\s\S]*WHERE email_key IS NOT NULL AND status = 'ACTIVE'/);
  assert.match(migration, /lead_contacts_merge_shape/);
});

test('migration adds the review queue and reversible merge ledger', () => {
  assert.match(migration, /CREATE TABLE platform\.lead_contact_duplicate_candidates/);
  assert.match(migration, /status text NOT NULL DEFAULT 'PENDING'/);
  assert.match(migration, /CREATE TABLE platform\.lead_contact_merges/);
  assert.match(migration, /reversed_at timestamptz/);
});

test('identity is organization-scoped for management and bound to the source at ingress', () => {
  assert.match(migration, /lead_contacts_organization_isolation[\s\S]*current_context_can_access_organization/);
  assert.match(migration, /current_public_capture_source_scope/);
  assert.match(migration, /current_signed_capture_source_scope/);
  // Ingress may only create ACTIVE, never a pre-merged contact.
  assert.match(migration, /WITH CHECK \(status = 'ACTIVE' AND merged_into_contact_id IS NULL/);
});

test('resolution auto-links only on exact email and queues everything else', () => {
  assert.match(resolution, /normalizeEmailKey/);
  assert.match(resolution, /email_key = \$3 AND status = 'ACTIVE'/);
  assert.match(resolution, /created: false/); // exact-email reuse path
  assert.match(resolution, /classifyMatch/);
  assert.match(resolution, /if \(result\.decision !== 'REVIEW'\) continue/);
  assert.match(resolution, /lead_contact_duplicate_candidates[\s\S]*ON CONFLICT[\s\S]*DO NOTHING/);
});

test('capture ingress links the resolved contact without ever failing capture', () => {
  assert.match(ingress, /resolveOrCreateLeadContact/);
  assert.match(ingress, /contact_id\)/); // contact_id added to the lead insert
  assert.match(ingress, /Capture contact resolution skipped/); // guarded
});
