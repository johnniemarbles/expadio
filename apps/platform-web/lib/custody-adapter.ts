import {
  delegatedSecretPath,
  type SecretVault,
  type SecretWriteRequest,
  type SecretWriteResult,
} from '@expadio/credential-custody';

/**
 * Design spec §3.2 — the custody service has KMS write and NO database access.
 *
 * Two implementations. Which one is active is a deployment decision, and the
 * environment variable that picks it is deliberately fail-closed: an
 * unconfigured production deployment refuses intake rather than falling back
 * to something weaker.
 */

/**
 * HashiCorp Vault KV v2. Chosen as the reference implementation because the
 * path model maps directly onto the tenant-scoped namespace in §2.2 and the
 * version counter is native rather than synthesised.
 */
class VaultSecretStore implements SecretVault {
  private readonly address: string;
  private readonly token: string;
  private readonly mount: string;

  constructor(address: string, token: string, mount = 'expadio') {
    this.address = address.replace(/\/+$/, '');
    this.token = token;
    this.mount = mount;
  }

  private dataPath(tenantId: string, connectorKey: string): string {
    return `${this.address}/v1/${this.mount}/data/tenant/${tenantId}/connector/${connectorKey}`;
  }

  private metadataPath(tenantId: string, connectorKey: string): string {
    return `${this.address}/v1/${this.mount}/metadata/tenant/${tenantId}/connector/${connectorKey}`;
  }

  async nextVersion(tenantId: string, connectorKey: string): Promise<string> {
    const response = await fetch(this.metadataPath(tenantId, connectorKey), {
      method: 'GET',
      headers: { 'X-Vault-Token': this.token },
    });
    if (response.status === 404) return 'v1';
    if (!response.ok) throw new Error(`Vault metadata read failed: HTTP ${response.status}`);
    const body = (await response.json()) as { data?: { current_version?: number } };
    return `v${(body.data?.current_version ?? 0) + 1}`;
  }

  async write(request: SecretWriteRequest): Promise<SecretWriteResult> {
    const version = await this.nextVersion(request.tenantId, request.connectorKey);

    const response = await fetch(this.dataPath(request.tenantId, request.connectorKey), {
      method: 'POST',
      headers: { 'X-Vault-Token': this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          // The secret is the only field. Provider metadata lives in Postgres,
          // which keeps this payload minimal and this blast radius small.
          secret: request.secret.toString('utf8'),
          providerKey: request.providerKey,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Vault write failed: HTTP ${response.status}`);
    }

    return {
      reference: delegatedSecretPath(request.tenantId, request.connectorKey, version),
      keyVersion: version,
      writtenAt: new Date().toISOString(),
    };
  }
}

/**
 * Development-only, in-process store. Refuses to run in production, because
 * a fallback that silently degrades custody is worse than an outage: the
 * outage is visible.
 */
class DevelopmentSecretStore implements SecretVault {
  private readonly versions = new Map<string, number>();

  async nextVersion(tenantId: string, connectorKey: string): Promise<string> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DevelopmentSecretStore must never run in production. Configure VAULT_ADDR and VAULT_TOKEN.',
      );
    }
    const key = `${tenantId}/${connectorKey}`;
    return `v${(this.versions.get(key) ?? 0) + 1}`;
  }

  async write(request: SecretWriteRequest): Promise<SecretWriteResult> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DevelopmentSecretStore must never run in production. Configure VAULT_ADDR and VAULT_TOKEN.',
      );
    }
    const key = `${request.tenantId}/${request.connectorKey}`;
    const next = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, next);
    // The secret is deliberately discarded rather than retained: this store
    // exists to exercise the flow, not to hold anything.
    return {
      reference: delegatedSecretPath(request.tenantId, request.connectorKey, `v${next}`),
      keyVersion: `v${next}`,
      writtenAt: new Date().toISOString(),
    };
  }
}

class LazySecretVault implements SecretVault {
  private delegate: SecretVault | null = null;

  private getDelegate(): SecretVault {
    if (this.delegate) return this.delegate;
    const address = process.env.VAULT_ADDR;
    const token = process.env.VAULT_TOKEN;
    if (address !== undefined && token !== undefined) {
      this.delegate = new VaultSecretStore(address, token, process.env.VAULT_MOUNT ?? 'expadio');
      return this.delegate;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('VAULT_ADDR and VAULT_TOKEN are required in production.');
    }
    this.delegate = new DevelopmentSecretStore();
    return this.delegate;
  }

  async nextVersion(tenantId: string, connectorKey: string): Promise<string> {
    return this.getDelegate().nextVersion(tenantId, connectorKey);
  }

  async write(request: SecretWriteRequest): Promise<SecretWriteResult> {
    return this.getDelegate().write(request);
  }
}

declare global {
  var _expadioSecretVault: SecretVault | undefined;
}

export const secretVault: SecretVault = globalThis._expadioSecretVault ?? new LazySecretVault();
if (process.env.NODE_ENV !== 'production') {
  globalThis._expadioSecretVault = secretVault;
}
