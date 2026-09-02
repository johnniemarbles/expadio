import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../app/api/communications/templates/route.ts', import.meta.url), 'utf8');

test('Brand template authoring is organization scoped and governance gated', () => {
  assert.match(source, /scope = 'ORGANIZATION'/);
  assert.match(source, /organization_id = \$2::uuid/);
  assert.match(source, /hasBrandGovernanceForOrganization/);
  assert.match(source, /VALUES \(COALESCE\(\$1::uuid, gen_random_uuid\(\)\), \$2, 'ORGANIZATION'/);
  assert.match(source, /'DRAFT'/);
});

test('Brand template revisions preserve identity and serialize version allocation', () => {
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /SELECT template_id, version/);
  assert.match(source, /const templateId = current\.rows\[0\]\?\.template_id \?\? null/);
  assert.match(source, /const nextVersion = \(current\.rows\[0\]\?\.version \?\? 0\) \+ 1/);
});

test('Brand template authoring cannot publish or operate delivery infrastructure', () => {
  assert.doesNotMatch(source, /status[^\n]*ACTIVE/);
  assert.doesNotMatch(source, /communication_provider_attempts|communication_provider_webhook_events|provider_registry|connector_key/);
  assert.doesNotMatch(source, /secretResolver|authToken|apiKey|wrapping-key/);
});
