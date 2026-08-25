import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresCommunicationTemplateRepository } from '../src/template.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: SqlQueryResult[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as SqlQueryResult<Row>;
  }
}

const organizationRow = {
  template_id: '11111111-1111-1111-1111-111111111111',
  version: 3,
  scope: 'ORGANIZATION',
  tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organization_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  trigger_key: 'lead.welcome',
  channel: 'email',
  locale: 'en',
  content_format: 'HTML',
  subject: 'Welcome {{name}}',
  title: null,
  body: '<p>Hello {{name}}</p>',
  required_variables: ['name'],
  default_variables: {},
  status: 'ACTIVE',
  created_at: '2026-08-25T04:00:00.000Z',
  updated_at: '2026-08-25T04:10:00.000Z',
};

test('resolveActive queries explicit organization -> tenant -> platform precedence', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [organizationRow], rowCount: 1 });

  const result = await new PostgresCommunicationTemplateRepository(client).resolveActive({
    tenantId: organizationRow.tenant_id,
    organizationId: organizationRow.organization_id,
    triggerKey: ' lead.welcome ',
    channel: 'email',
    locale: ' EN ',
  });

  assert.equal(result.matchedScope, 'ORGANIZATION');
  assert.equal(result.template?.scope.kind, 'ORGANIZATION');
  assert.equal(result.template?.version, 3);
  assert.equal(result.template?.content.subject, 'Welcome {{name}}');
  assert.deepEqual(client.calls[0]?.values, [
    organizationRow.tenant_id,
    organizationRow.organization_id,
    'lead.welcome',
    'email',
    'en',
  ]);
  assert.match(client.calls[0]?.text ?? '', /WHEN 'ORGANIZATION' THEN 1/);
  assert.match(client.calls[0]?.text ?? '', /WHEN 'TENANT' THEN 2/);
  assert.match(client.calls[0]?.text ?? '', /WHEN 'PLATFORM' THEN 3/);
});

test('resolveActive without organization excludes organization templates', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{ ...organizationRow, scope: 'TENANT', organization_id: null }],
    rowCount: 1,
  });

  const result = await new PostgresCommunicationTemplateRepository(client).resolveActive({
    tenantId: organizationRow.tenant_id,
    triggerKey: 'lead.welcome',
    channel: 'email',
  });

  assert.equal(result.matchedScope, 'TENANT');
  assert.equal(result.template?.scope.kind, 'TENANT');
  assert.equal(client.calls[0]?.values[1], null);
  assert.match(client.calls[0]?.text ?? '', /\$2::uuid IS NOT NULL/);
});

test('resolveActive maps a platform default without tenant identifiers', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{
      ...organizationRow,
      scope: 'PLATFORM',
      tenant_id: null,
      organization_id: null,
      content_format: 'TEXT',
      subject: null,
      body: 'Platform hello',
      required_variables: [],
    }],
    rowCount: 1,
  });

  const result = await new PostgresCommunicationTemplateRepository(client).resolveActive({
    tenantId: organizationRow.tenant_id,
    triggerKey: 'lead.welcome',
    channel: 'email',
  });

  assert.equal(result.matchedScope, 'PLATFORM');
  assert.deepEqual(result.template?.scope, { kind: 'PLATFORM' });
  assert.equal(result.template?.content.body, 'Platform hello');
});

test('resolveActive returns NONE when no active template matches', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  const result = await new PostgresCommunicationTemplateRepository(client).resolveActive({
    tenantId: organizationRow.tenant_id,
    triggerKey: 'missing.trigger',
    channel: 'sms',
  });

  assert.deepEqual(result, { matchedScope: 'NONE', template: null });
});
