import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../lib/brand-context.ts', import.meta.url), 'utf8');

test('Brand transactions apply the full tenant, subject, issuer, and organization RLS context', () => {
  assert.match(source, /set_config\('app\.tenant_id',\$1,true\)/);
  assert.match(source, /set_config\('app\.subject_id',\$2,true\)/);
  assert.match(source, /set_config\('app\.issuer',\$3,true\)/);
  assert.match(source, /set_config\('app\.organization_id',\$4,true\)/);
  assert.match(source, /\[context\.tenantId,context\.subjectId,context\.issuer,context\.organizationId\]/);
  assert.doesNotMatch(source, /SELECT set_config\('app\.tenant_id',\$1,true\)\)\s*,?\s*\[context\.tenantId\]/);
});
