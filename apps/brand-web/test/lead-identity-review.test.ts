import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const lib = read('../lib/lead-identity-review.ts');
const listRoute = read('../app/api/leads/identity/candidates/route.ts');
const actionRoute = read('../app/api/leads/identity/candidates/[candidateId]/route.ts');
const reverseRoute = read('../app/api/leads/identity/merges/[mergeId]/reverse/route.ts');

test('merge uses the domain rules and records reversible, non-destructive evidence', () => {
  assert.match(lib, /chooseSurvivor/);
  assert.match(lib, /planContactMerge/);
  // The duplicate is flipped to MERGED (retained), never deleted.
  assert.match(lib, /status = 'MERGED', merged_into_contact_id/);
  assert.doesNotMatch(lib, /DELETE FROM platform\.lead_contacts/);
  // Capture leads are relinked to the survivor and evidence is written.
  assert.match(lib, /UPDATE platform\.lead_capture_leads SET contact_id/);
  assert.match(lib, /INSERT INTO platform\.lead_contact_merges/);
  assert.match(lib, /status = 'CONFIRMED'/);
});

test('reverse reactivates the merged contact and stamps the ledger', () => {
  assert.match(lib, /reverseContactMerge/);
  assert.match(lib, /status = 'ACTIVE', merged_into_contact_id = NULL/);
  assert.match(lib, /reversed_at = now\(\)/);
});

test('review endpoints are organization-governed', () => {
  assert.match(listRoute, /resolveBrandContext/);
  assert.match(listRoute, /ORGANIZATION_CONTEXT_REQUIRED/);
  for (const route of [actionRoute, reverseRoute]) {
    assert.match(route, /resolveBrandContext/);
    assert.match(route, /hasBrandGovernanceForOrganization/);
    assert.match(route, /withBrandTransaction/);
  }
  assert.match(actionRoute, /action !== 'confirm' && action !== 'dismiss'/);
});
