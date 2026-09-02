import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../../infra/db/migrations');

test('new migration ordinals are unique from 0119 onward', () => {
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  const byOrdinal = new Map<string, string[]>();
  for (const file of files) {
    const ordinal = file.slice(0, 4);
    const group = byOrdinal.get(ordinal) ?? [];
    group.push(file);
    byOrdinal.set(ordinal, group);
  }

  const duplicatesAfter0118 = [...byOrdinal.entries()]
    .filter(([ordinal, group]) => Number(ordinal) >= 119 && group.length > 1);

  assert.deepEqual(
    duplicatesAfter0118,
    [],
    'Migration ordinals from 0119 onward must be unique; deployed historical duplicates are not renamed.',
  );
  assert.ok(
    files.includes('0119_entity_registry_integrity.sql'),
    'Entity registry integrity must remain the canonical 0119 migration.',
  );
});
