export interface VaultDelegatedSecretResolverOptions {
  readonly address?: string;
  readonly token?: string;
  readonly mount?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface ResolvedDelegatedSecret {
  readonly value: string;
  readonly version: string;
}

export type VaultDelegatedSecretResolverErrorCode =
  | 'VAULT_REFERENCE_INVALID'
  | 'VAULT_NOT_CONFIGURED'
  | 'VAULT_SECRET_NOT_FOUND'
  | 'VAULT_SECRET_READ_FAILED'
  | 'VAULT_SECRET_INVALID';

export class VaultDelegatedSecretResolverError extends Error {
  readonly code: VaultDelegatedSecretResolverErrorCode;

  constructor(code: VaultDelegatedSecretResolverErrorCode, message: string) {
    super(message);
    this.name = 'VaultDelegatedSecretResolverError';
    this.code = code;
  }
}

interface ParsedVaultReference {
  readonly tenantId: string;
  readonly connectorKey: string;
  readonly version: number;
}

const VAULT_REFERENCE =
  /^vault:\/\/tenant\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/connector\/([A-Za-z0-9._-]{1,128})\/v([0-9]{1,6})$/;

/**
 * Infrastructure-only resolver for delegated Vault KV v2 references.
 *
 * This is deliberately separate from the custody write adapter. The database
 * stores only the opaque reference; plaintext exists only in this method's
 * local scope for the duration of the provider call.
 */
export class VaultDelegatedSecretResolver {
  readonly #address?: string;
  readonly #token?: string;
  readonly #mount: string;
  readonly #fetch: typeof fetch;

  constructor(options: VaultDelegatedSecretResolverOptions = {}) {
    this.#address = normalizeAddress(options.address ?? process.env.VAULT_ADDR);
    this.#token = options.token ?? process.env.VAULT_TOKEN;
    this.#mount = normalizeMount(options.mount ?? process.env.VAULT_MOUNT ?? 'expadio');
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async resolve(reference: string): Promise<ResolvedDelegatedSecret> {
    const parsed = parseVaultReference(reference);
    if (this.#address === undefined || this.#token === undefined || this.#token.trim() === '') {
      throw new VaultDelegatedSecretResolverError(
        'VAULT_NOT_CONFIGURED',
        'Vault secret resolution is not configured for this deployment.',
      );
    }

    const path =
      `${this.#address}/v1/${encodeURIComponent(this.#mount)}/data/tenant/` +
      `${parsed.tenantId}/connector/${encodeURIComponent(parsed.connectorKey)}` +
      `?version=${parsed.version}`;

    const response = await this.#fetch(path, {
      method: 'GET',
      headers: { 'X-Vault-Token': this.#token },
      cache: 'no-store',
    });

    if (response.status === 404) {
      throw new VaultDelegatedSecretResolverError(
        'VAULT_SECRET_NOT_FOUND',
        'The delegated provider credential could not be found in Vault.',
      );
    }
    if (!response.ok) {
      throw new VaultDelegatedSecretResolverError(
        'VAULT_SECRET_READ_FAILED',
        `Vault secret read failed with HTTP ${response.status}.`,
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          data?: {
            data?: { secret?: unknown };
            metadata?: { version?: unknown };
          };
        }
      | null;
    const secret = payload?.data?.data?.secret;
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new VaultDelegatedSecretResolverError(
        'VAULT_SECRET_INVALID',
        'Vault returned a credential payload without a usable secret value.',
      );
    }

    const metadataVersion = payload?.data?.metadata?.version;
    if (metadataVersion !== parsed.version) {
      throw new VaultDelegatedSecretResolverError(
        'VAULT_SECRET_INVALID',
        'Vault did not return the requested credential version.',
      );
    }

    return { value: secret, version: `v${parsed.version}` };
  }
}

export const delegatedSecretResolver = new VaultDelegatedSecretResolver();

function parseVaultReference(reference: string): ParsedVaultReference {
  const match = VAULT_REFERENCE.exec(reference);
  if (match === null) {
    throw new VaultDelegatedSecretResolverError(
      'VAULT_REFERENCE_INVALID',
      'Credential reference is not a valid delegated Vault reference.',
    );
  }

  const tenantId = match[1];
  const connectorKey = match[2];
  const versionText = match[3];
  if (tenantId === undefined || connectorKey === undefined || versionText === undefined) {
    throw new VaultDelegatedSecretResolverError(
      'VAULT_REFERENCE_INVALID',
      'Credential reference is incomplete.',
    );
  }

  const version = Number(versionText);
  if (!Number.isInteger(version) || version < 1) {
    throw new VaultDelegatedSecretResolverError(
      'VAULT_REFERENCE_INVALID',
      'Credential reference version is invalid.',
    );
  }

  return { tenantId, connectorKey, version };
}

function normalizeAddress(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return value.trim().replace(/\/+$/u, '');
}

function normalizeMount(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/gu, '');
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(normalized)) {
    throw new VaultDelegatedSecretResolverError(
      'VAULT_NOT_CONFIGURED',
      'Vault mount name is invalid.',
    );
  }
  return normalized;
}
