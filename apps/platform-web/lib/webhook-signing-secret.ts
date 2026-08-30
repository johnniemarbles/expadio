import type { WrappedSecretEnvelope, WrappingKeyStore } from '@expadio/credential-custody';
import { zeroise } from '@expadio/credential-custody';

const REFERENCE =
  /^vault:\/\/tenant\/([0-9a-fA-F-]{36})\/connector\/([A-Za-z0-9._-]{1,128})\/webhook\/v([0-9]{1,6})$/;

export interface WebhookSigningSecretWriteResult {
  readonly reference: string;
  readonly keyVersion: string;
  readonly writtenAt: string;
}

export interface WebhookSigningSecretStore {
  write(input: {
    readonly tenantId: string;
    readonly connectorKey: string;
    readonly secret: Buffer;
  }): Promise<WebhookSigningSecretWriteResult>;
  resolve(reference: string): Promise<string>;
}

function reference(tenantId: string, connectorKey: string, version: number): string {
  if (!/^[0-9a-fA-F-]{36}$/.test(tenantId)) throw new Error('WEBHOOK_SECRET_TENANT_INVALID');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(connectorKey)) throw new Error('WEBHOOK_SECRET_CONNECTOR_INVALID');
  if (!Number.isInteger(version) || version < 1 || version > 999999) {
    throw new Error('WEBHOOK_SECRET_VERSION_INVALID');
  }
  return `vault://tenant/${tenantId}/connector/${connectorKey}/webhook/v${version}`;
}

class VaultWebhookSigningSecretStore implements WebhookSigningSecretStore {
  readonly #address: string;
  readonly #token: string;
  readonly #mount: string;

  constructor(address: string, token: string, mount: string) {
    this.#address = address.replace(/\/+$/u, '');
    this.#token = token;
    this.#mount = mount.replace(/^\/+|\/+$/gu, '');
  }

  #metadataPath(tenantId: string, connectorKey: string): string {
    return `${this.#address}/v1/${encodeURIComponent(this.#mount)}/metadata/tenant/${tenantId}/connector/${encodeURIComponent(connectorKey)}/webhook`;
  }

  #dataPath(tenantId: string, connectorKey: string): string {
    return `${this.#address}/v1/${encodeURIComponent(this.#mount)}/data/tenant/${tenantId}/connector/${encodeURIComponent(connectorKey)}/webhook`;
  }

  async write(input: {
    readonly tenantId: string;
    readonly connectorKey: string;
    readonly secret: Buffer;
  }): Promise<WebhookSigningSecretWriteResult> {
    let nextVersion = 1;
    const metadata = await fetch(this.#metadataPath(input.tenantId, input.connectorKey), {
      method: 'GET',
      headers: { 'X-Vault-Token': this.#token },
      cache: 'no-store',
    });
    if (metadata.ok) {
      const body = await metadata.json() as { data?: { current_version?: unknown } };
      const current = body.data?.current_version;
      if (typeof current === 'number' && Number.isInteger(current) && current >= 0) {
        nextVersion = current + 1;
      }
    } else if (metadata.status !== 404) {
      throw new Error(`WEBHOOK_SECRET_VAULT_METADATA_FAILED:${metadata.status}`);
    }

    const response = await fetch(this.#dataPath(input.tenantId, input.connectorKey), {
      method: 'POST',
      headers: {
        'X-Vault-Token': this.#token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { secret: input.secret.toString('utf8'), purpose: 'resend-webhook-signing' } }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`WEBHOOK_SECRET_VAULT_WRITE_FAILED:${response.status}`);

    return {
      reference: reference(input.tenantId, input.connectorKey, nextVersion),
      keyVersion: `v${nextVersion}`,
      writtenAt: new Date().toISOString(),
    };
  }

  async resolve(secretReference: string): Promise<string> {
    const match = REFERENCE.exec(secretReference);
    if (match === null) throw new Error('WEBHOOK_SECRET_REFERENCE_INVALID');
    const tenantId = match[1]!;
    const connectorKey = match[2]!;
    const version = Number(match[3]!);

    const response = await fetch(
      `${this.#dataPath(tenantId, connectorKey)}?version=${version}`,
      {
        method: 'GET',
        headers: { 'X-Vault-Token': this.#token },
        cache: 'no-store',
      },
    );
    if (!response.ok) throw new Error(`WEBHOOK_SECRET_VAULT_READ_FAILED:${response.status}`);
    const body = await response.json() as { data?: { data?: { secret?: unknown } } };
    const secret = body.data?.data?.secret;
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new Error('WEBHOOK_SECRET_VAULT_VALUE_INVALID');
    }
    return secret;
  }
}

class DevelopmentWebhookSigningSecretStore implements WebhookSigningSecretStore {
  readonly #values = new Map<string, string>();
  readonly #versions = new Map<string, number>();

  async write(input: {
    readonly tenantId: string;
    readonly connectorKey: string;
    readonly secret: Buffer;
  }): Promise<WebhookSigningSecretWriteResult> {
    if (process.env.NODE_ENV === 'production') throw new Error('WEBHOOK_SECRET_DEV_STORE_FORBIDDEN');
    const key = `${input.tenantId}/${input.connectorKey}`;
    const version = (this.#versions.get(key) ?? 0) + 1;
    this.#versions.set(key, version);
    const ref = reference(input.tenantId, input.connectorKey, version);
    this.#values.set(ref, input.secret.toString('utf8'));
    return { reference: ref, keyVersion: `v${version}`, writtenAt: new Date().toISOString() };
  }

  async resolve(secretReference: string): Promise<string> {
    if (process.env.NODE_ENV === 'production') throw new Error('WEBHOOK_SECRET_DEV_STORE_FORBIDDEN');
    const value = this.#values.get(secretReference);
    if (value === undefined) throw new Error('WEBHOOK_SECRET_NOT_FOUND');
    return value;
  }
}

class LazyWebhookSigningSecretStore implements WebhookSigningSecretStore {
  #delegate: WebhookSigningSecretStore | null = null;

  #get(): WebhookSigningSecretStore {
    if (this.#delegate !== null) return this.#delegate;
    const address = process.env.VAULT_ADDR?.trim();
    const token = process.env.VAULT_TOKEN?.trim();
    if (address && token) {
      this.#delegate = new VaultWebhookSigningSecretStore(
        address,
        token,
        process.env.VAULT_MOUNT?.trim() || 'expadio',
      );
      return this.#delegate;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('WEBHOOK_SECRET_VAULT_NOT_CONFIGURED');
    }
    this.#delegate = new DevelopmentWebhookSigningSecretStore();
    return this.#delegate;
  }

  write(input: { readonly tenantId: string; readonly connectorKey: string; readonly secret: Buffer }) {
    return this.#get().write(input);
  }

  resolve(secretReference: string) {
    return this.#get().resolve(secretReference);
  }
}

declare global {
  var _expadioWebhookSigningSecretStore: WebhookSigningSecretStore | undefined;
}

export const webhookSigningSecretStore =
  globalThis._expadioWebhookSigningSecretStore ?? new LazyWebhookSigningSecretStore();

if (process.env.NODE_ENV !== 'production') {
  globalThis._expadioWebhookSigningSecretStore = webhookSigningSecretStore;
}

export async function intakeWebhookSigningSecret(input: {
  readonly tenantId: string;
  readonly connectorKey: string;
  readonly envelope: WrappedSecretEnvelope;
  readonly wrappingKeys: WrappingKeyStore;
  readonly store?: WebhookSigningSecretStore;
}): Promise<WebhookSigningSecretWriteResult> {
  let secret: Buffer;
  try {
    secret = input.wrappingKeys.unwrap(input.envelope);
  } catch (error) {
    throw new Error(`WEBHOOK_SECRET_UNWRAP_FAILED:${(error as Error).message}`);
  }

  try {
    const value = secret.toString('utf8').trim();
    if (!value.startsWith('whsec_') || value.length < 12 || value.length > 4096) {
      throw new Error('WEBHOOK_SECRET_FORMAT_INVALID');
    }
    return await (input.store ?? webhookSigningSecretStore).write({
      tenantId: input.tenantId,
      connectorKey: input.connectorKey,
      secret,
    });
  } finally {
    zeroise(secret);
  }
}

export function assertWebhookSecretReference(input: {
  readonly reference: string;
  readonly tenantId: string;
  readonly connectorKey: string;
}): void {
  const match = REFERENCE.exec(input.reference);
  if (
    match === null
    || match[1]?.toLowerCase() !== input.tenantId.toLowerCase()
    || match[2] !== input.connectorKey
  ) {
    throw new Error('WEBHOOK_SECRET_REFERENCE_SCOPE_INVALID');
  }
}
