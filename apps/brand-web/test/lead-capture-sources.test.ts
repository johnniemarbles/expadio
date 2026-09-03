import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../app/api/leads/capture-sources/route.ts', import.meta.url), 'utf8');

test('Brand source registration is organization-bound and governance-gated', () => {
  assert.match(source, /resolveBrandContext\(\)/);
  assert.match(source, /withBrandTransaction/);
  assert.match(source, /hasBrandGovernanceForOrganization/);
  assert.match(source, /context\.organizationId/);
  assert.match(source, /require_signed_ticket, status, verification_algorithm/);
  assert.match(source, /true, 'ACTIVE', 'ED25519'/);
});

test('Brand stores only Ed25519 public verification material', () => {
  assert.match(source, /createPublicKey/);
  assert.match(source, /asymmetricKeyType !== 'ed25519'/);
  assert.match(source, /verification_public_key/);
  assert.doesNotMatch(source, /privateKey/);
  assert.doesNotMatch(source, /sharedSecret/);
  assert.doesNotMatch(source, /apiToken/);
  assert.doesNotMatch(source, /credentialRef/);
});

test('capture authority is not accepted from Brand request body', () => {
  assert.doesNotMatch(source, /body\.tenantId/);
  assert.doesNotMatch(source, /body\.organizationId/);
  assert.doesNotMatch(source, /body\.stage/);
});
