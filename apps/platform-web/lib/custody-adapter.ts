import type { SecretVault } from '@expadio/credential-custody';

export const secretVault: SecretVault = {
  async write(request) {
    throw new Error('SecretVault is not fully wired yet.');
  },
  async nextVersion(tenantId, connectorKey) {
    return 'v1';
  }
};
