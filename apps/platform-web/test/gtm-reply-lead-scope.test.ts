import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../app/api/gtm/replies/route.ts', import.meta.url), 'utf8');

test('warm-reply Lead conversion is organization-scoped and atomic with the observation', () => {
  assert.match(source, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(source, /withTenantTransaction\(context/);
  assert.match(source, /\(tenant_id, organization_id, title, stage, source, raw_payload, owner_subject_id\)/);
  assert.match(source, /context\.organizationId/);
  assert.doesNotMatch(source, /withTenantClient\(context, async \(client\) => \{[\s\S]*INSERT INTO platform\.gtm_reply_observations[\s\S]*INSERT INTO platform\.crm_leads/);
});
