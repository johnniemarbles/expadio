import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('../app/api/crm/cases/[id]/workflow/route.ts');
const lifecycle = read('../lib/crm-case-lifecycle-event.ts');

test('case workflow transition appends lifecycle event before transaction commit', () => {
  const updateIndex = route.indexOf('UPDATE platform.crm_cases SET stage_key');
  const eventIndex = route.indexOf('appendCrmCaseLifecycleEvent(client');
  const commitIndex = route.indexOf("await client.query('COMMIT');", eventIndex);

  assert.ok(updateIndex >= 0);
  assert.ok(eventIndex > updateIndex);
  assert.ok(commitIndex > eventIndex);
  assert.match(route, /industry_pack_vertical_key/);
  assert.match(route, /industry_pack_version/);
  assert.match(route, /industry_pack_runtime_source/);
  assert.match(route, /domainEventId/);
});

test('lifecycle event adapter resolves pinned Pack and never embeds Treatment PII', () => {
  assert.match(lifecycle, /version = \$3/);
  assert.match(lifecycle, /resolveCaseLifecycleEvent/);
  assert.match(lifecycle, /appendDomainEventWithOutbox/);
  assert.match(lifecycle, /fromStageKey/);
  assert.match(lifecycle, /toStageKey/);
  assert.doesNotMatch(lifecycle, /patient_email|patientEmail|patientName/);
});
