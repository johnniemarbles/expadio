import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VaultDelegatedSecretResolver,
  VaultDelegatedSecretResolverError,
} from '../lib/vault-secret-resolver.ts';

const reference =
  'vault://tenant/11111111-1111-1111-1111-111111111111/connector/resend-primary/v3';

test('resolves an exact Vault KV v2 version without disclosing the token in the URL', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        data: {
          data: { secret: 're_live_secret' },
          metadata: { version: 3 },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const resolver = new VaultDelegatedSecretResolver({
    address: 'https://vault.example.test/',
    token: 'vault-token',
    mount: 'expadio',
    fetchImpl,
  });

  const resolved = await resolver.resolve(reference);

  assert.deepEqual(resolved, { value: 're_live_secret', version: 'v3' });
  assert.equal(
    calls[0]?.url,
    'https://vault.example.test/v1/expadio/data/tenant/11111111-1111-1111-1111-111111111111/connector/resend-primary?version=3',
  );
  assert.equal(new Headers(calls[0]?.init?.headers).get('X-Vault-Token'), 'vault-token');
  assert.doesNotMatch(calls[0]?.url ?? '', /vault-token|re_live_secret/);
});

test('rejects malformed references before any network call', async () => {
  let called = false;
  const resolver = new VaultDelegatedSecretResolver({
    address: 'https://vault.example.test',
    token: 'vault-token',
    fetchImpl: async () => {
      called = true;
      return new Response('{}', { status: 200 });
    },
  });

  await assert.rejects(
    resolver.resolve('vault://tenant/not-a-uuid/connector/resend-primary/v3'),
    (error: unknown) =>
      error instanceof VaultDelegatedSecretResolverError &&
      error.code === 'VAULT_REFERENCE_INVALID',
  );
  assert.equal(called, false);
});

test('fails closed when Vault is not configured', async () => {
  const resolver = new VaultDelegatedSecretResolver({
    address: '',
    token: '',
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });

  await assert.rejects(
    resolver.resolve(reference),
    (error: unknown) =>
      error instanceof VaultDelegatedSecretResolverError &&
      error.code === 'VAULT_NOT_CONFIGURED',
  );
});

test('distinguishes missing secret from other Vault read failures', async () => {
  const missing = new VaultDelegatedSecretResolver({
    address: 'https://vault.example.test',
    token: 'vault-token',
    fetchImpl: async () => new Response('{}', { status: 404 }),
  });
  await assert.rejects(
    missing.resolve(reference),
    (error: unknown) =>
      error instanceof VaultDelegatedSecretResolverError &&
      error.code === 'VAULT_SECRET_NOT_FOUND',
  );

  const unavailable = new VaultDelegatedSecretResolver({
    address: 'https://vault.example.test',
    token: 'vault-token',
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });
  await assert.rejects(
    unavailable.resolve(reference),
    (error: unknown) =>
      error instanceof VaultDelegatedSecretResolverError &&
      error.code === 'VAULT_SECRET_READ_FAILED',
  );
});

test('rejects a successful Vault response that contains no secret value', async () => {
  const resolver = new VaultDelegatedSecretResolver({
    address: 'https://vault.example.test',
    token: 'vault-token',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ data: { data: {}, metadata: { version: 3 } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  });

  await assert.rejects(
    resolver.resolve(reference),
    (error: unknown) =>
      error instanceof VaultDelegatedSecretResolverError &&
      error.code === 'VAULT_SECRET_INVALID',
  );
});

for (const version of [undefined, null, '3', 2, 4, 3.5, 0]) {
  test(`rejects missing or mismatched Vault version metadata: ${String(version)}`, async () => {
    const resolver = new VaultDelegatedSecretResolver({
      address: 'https://vault.example.test', token: 'vault-token',
      fetchImpl: async () => Response.json({ data: { data: { secret: 'must-not-escape' }, metadata: { version } } }),
    });
    await assert.rejects(resolver.resolve(reference), (error: unknown) =>
      error instanceof VaultDelegatedSecretResolverError && error.code === 'VAULT_SECRET_INVALID'
        && !error.message.includes('must-not-escape'));
  });
}

test('rejects a UUID-shaped sequence with invalid hyphen positions without contacting Vault', async () => {
  let calls = 0;
  const resolver = new VaultDelegatedSecretResolver({
    address: 'https://vault.example.test', token: 'vault-token',
    fetchImpl: async () => { calls++; return Response.json({}); },
  });
  await assert.rejects(resolver.resolve(`vault://tenant/${'-'.repeat(36)}/connector/resend/v1`),
    (error: unknown) => error instanceof VaultDelegatedSecretResolverError && error.code === 'VAULT_REFERENCE_INVALID');
  assert.equal(calls, 0);
});
