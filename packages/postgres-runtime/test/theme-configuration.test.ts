import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';
import {
  appendPlatformThemeProfile,
  appendTenantThemeOverride,
  listPlatformThemeProfiles,
  listTenantThemeOverrides,
} from '../src/theme-configuration.ts';

class Client implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly steps: Array<SqlQueryResult | Error> = [];

  async query<Row = Record<string, unknown>>(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values });
    const step = this.steps.shift() ?? { rows: [], rowCount: 0 };
    if (step instanceof Error) throw step;
    return step as SqlQueryResult<Row>;
  }
}

const profile = {
  schemaVersion: 1,
  key: 'expadio-command-obsidian',
  name: 'EXPADIO Command / Obsidian',
};
const override = { primary: '#112233', accent: '#445566' };

function definition(version = 1): SqlQueryResult<{ version: number }> {
  return { rows: [{ version }], rowCount: 1 };
}

function nextVersion(next_version: number): SqlQueryResult<{ next_version: number }> {
  return { rows: [{ next_version }], rowCount: 1 };
}

function row(value: unknown, record_version: number, level: 'PLATFORM' | 'TENANT' = 'PLATFORM') {
  return {
    value_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    setting_key: level === 'PLATFORM' ? 'appearance.theme.profile' : 'appearance.theme.override',
    level,
    scope_id: level === 'PLATFORM' ? null : 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    tenant_id: level === 'PLATFORM' ? null : 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    record_version,
    value,
    authored_by_subject_id: 'subject-1',
    authored_at: '2026-09-01T17:00:00.000Z',
    reason: 'test publication',
    correlation_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  };
}

test('platform profile publication is append-only and globally scoped', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 }, definition(), nextVersion(3), { rows: [row(profile, 3)], rowCount: 1 });

  const published = await appendPlatformThemeProfile(client, {
    valueId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    value: profile,
    actorSubjectId: 'subject-1',
    reason: 'publish platform preset',
    correlationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    evidenceRefs: ['appearance:preset-publication'],
  });

  assert.equal(published.level, 'PLATFORM');
  assert.equal(published.scopeId, null);
  assert.equal(published.tenantId, null);
  assert.equal(published.recordVersion, 3);
  assert.match(client.calls[0]?.text ?? '', /pg_advisory_xact_lock\(hashtext\('appearance\.theme\.profile:PLATFORM'\)\)/);
  assert.match(client.calls[2]?.text ?? '', /COALESCE\(MAX\(record_version\),0\)\+1/);
  assert.match(client.calls[3]?.text ?? '', /'PLATFORM',NULL,NULL/);
  assert.deepEqual(client.calls[3]?.values.at(-1), ['appearance:preset-publication']);
});

test('tenant override publication is tenant scoped and versioned per tenant', async () => {
  const client = new Client();
  client.steps.push({ rows: [], rowCount: 1 }, definition(), nextVersion(2), { rows: [row(override, 2, 'TENANT')], rowCount: 1 });

  const published = await appendTenantThemeOverride(client, {
    valueId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    value: override,
    actorSubjectId: 'subject-1',
    reason: 'publish brand override',
    correlationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    evidenceRefs: ['appearance:brand-publication'],
  });

  assert.equal(published.level, 'TENANT');
  assert.equal(published.tenantId, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  assert.equal(published.scopeId, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  assert.equal(published.recordVersion, 2);
  assert.match(client.calls[0]?.text ?? '', /appearance\.theme\.override:'\|\|\$1::text/);
  assert.deepEqual(client.calls[2]?.values, ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
  assert.match(client.calls[3]?.text ?? '', /'TENANT',\$3::text,\$3::uuid/);
});

test('appearance history readers are bounded and ordered newest first', async () => {
  const client = new Client();
  client.steps.push({ rows: [row(profile, 4)], rowCount: 1 });
  client.steps.push({ rows: [row(override, 5, 'TENANT')], rowCount: 1 });

  const platform = await listPlatformThemeProfiles(client, 1000);
  const tenant = await listTenantThemeOverrides(client, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1000);

  assert.equal(platform[0]?.recordVersion, 4);
  assert.equal(tenant[0]?.recordVersion, 5);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY record_version DESC/);
  assert.match(client.calls[1]?.text ?? '', /tenant_id=\$1::uuid/);
  assert.deepEqual(client.calls[0]?.values, [100]);
  assert.deepEqual(client.calls[1]?.values, ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 100]);
});
