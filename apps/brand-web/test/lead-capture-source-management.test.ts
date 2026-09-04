import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('../app/api/leads/capture-sources/route.ts');

test('capture source creation is organization-governed', () => {
  assert.match(route, /resolveBrandContext/);
  assert.match(route, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(route, /hasBrandGovernanceForOrganization/);
  // Writes run under the brand transaction (organization-scoped RLS).
  assert.match(route, /withBrandTransaction/);
});

test('SIGNED sources require an Ed25519 key; PUBLIC sources get a generated key + origins', () => {
  assert.match(route, /trustRail === 'SIGNED'/);
  assert.match(route, /normalizePublicKey\(body\.verificationPublicKey\)/);
  assert.match(route, /generatePublishableKey\(\)/);
  assert.match(route, /normalizeOrigins\(rawOrigins\)/);
  // PUBLIC sources do not require a signed ticket; SIGNED ones do.
  assert.match(route, /trustRail === 'SIGNED',/);
});

test('inputs are bounded to the known enums', () => {
  assert.match(route, /TRUST_RAILS = new Set\(\['SIGNED', 'PUBLIC'\]\)/);
  assert.match(route, /CHANNELS = new Set\(\['WEB', 'EMAIL', 'SMS', 'WHATSAPP', 'SOCIAL', 'IMPORT', 'MANUAL', 'API'\]\)/);
  assert.match(route, /Unsupported trust rail/);
  assert.match(route, /Unsupported channel/);
});

test('the publishable key is a public identifier the operator can wire into the embed', () => {
  // It is deliberately returned on creation and read back on GET.
  assert.match(route, /publishableKey: row\.publishable_key/);
  // No private-key material is generated or returned for the public rail.
  assert.doesNotMatch(route, /privateKey|private_key|verification_private/);
});


test('source publication policy is normalized, persisted, and returned', () => {
  assert.match(route, /normalizeCaptureSourcePublicationConfig\(body\.publicationConfig \?\? \{\}\)/);
  assert.match(route, /JSON\.stringify\(\{ publicationConfig \}\)/);
  assert.match(route, /publicationConfig: normalizeCaptureSourcePublicationConfig\(row\.metadata\?\.publicationConfig \?\? \{\}\)/);
  assert.match(route, /CaptureSourceConfigError/);
  assert.doesNotMatch(route, /body\.(tenantId|organizationId)/);
});
