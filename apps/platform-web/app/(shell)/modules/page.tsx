import type {
  TenantModuleEntitlementRecord,
  TenantProductModuleSummary,
} from '@expadio/postgres-runtime/product-module';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { ModuleAction } from '../../../components/ModuleAction/ModuleAction';
import { EntitlementManager } from '../../../components/EntitlementManager/EntitlementManager';
import { brandHandoffUrl, loadBrandAppOrigin } from '../../../lib/brand-app';
import { fetchApi, liveWorkspaceAdapter } from '../../../lib/live-adapter';
import styles from './page.module.css';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stateLabel(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function TenantModulesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const workspace = await liveWorkspaceAdapter.loadWorkspaceContext();
  const requestedAccount = one(params.account);
  const account = workspace.accounts.find((item) => item.id === requestedAccount) ?? workspace.accounts[0];
  const allowed = account
    ? workspace.organizations.filter((item) => account.allowedOrganizationIds.includes(item.id))
    : [];
  const requestedOrg = one(params.org);
  const organization = allowed.find((item) => item.id === requestedOrg) ?? allowed[0];

  if (!account || !organization) {
    return <section className={styles.notice}>No tenant workspace is available for module management.</section>;
  }

  const query = new URLSearchParams({ account: account.id, org: organization.id });
  const result = await fetchApi<{ modules: readonly TenantProductModuleSummary[] }>(
    `/api/tenant/modules?${query}`,
  );
  if (isDenied(result)) return <DeniedState result={result} />;

  const entitlementResults = await Promise.all(
    result.modules.map(async (module) => {
      const response = await fetchApi<{ entitlements: readonly TenantModuleEntitlementRecord[] }>(
        `/api/platform/tenant/modules/${encodeURIComponent(module.moduleKey)}/entitlements?${query}`,
      );
      return [
        module.moduleKey,
        isDenied(response) ? null : response.entitlements,
      ] as const;
    }),
  );
  const entitlementHistory = new Map(entitlementResults);
  const brandOrigin = loadBrandAppOrigin();

  return (
    <>
      <section className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>Platform · Tenant products</p>
          <h1>Apps & modules</h1>
          <p>Manage commercial entitlement, installation state and tenant activation for {account.name}. Only Platform-owned administration roles can grant or revoke module entitlement.</p>
        </div>
      </section>

      <section className={styles.summaryGrid}>
        <article className={styles.summary}><span>Catalog</span><strong>{result.modules.length}</strong></article>
        <article className={styles.summary}><span>Active</span><strong>{result.modules.filter((item) => item.availability === 'ACTIVE').length}</strong></article>
        <article className={styles.summary}><span>Ready</span><strong>{result.modules.filter((item) => item.availability === 'READY_TO_ACTIVATE').length}</strong></article>
        <article className={styles.summary}><span>Plan locked</span><strong>{result.modules.filter((item) => item.availability === 'LOCKED_BY_PLAN').length}</strong></article>
      </section>

      <section className={styles.moduleGrid}>
        {result.modules.map((module) => {
          const brandHref = brandOrigin
            ? brandHandoffUrl(brandOrigin, {
                tenantId: account.id,
                organizationId: organization.id,
                returnTo: typeof module.manifest.route === 'string' ? module.manifest.route : '/',
              })
            : null;
          return (
            <article className={styles.card} key={module.moduleKey}>
              <div className={styles.cardHead}>
                <div><h2>{module.displayName}</h2><p>{module.description}</p></div>
                <span className={styles.state}>{stateLabel(module.availability)}</span>
              </div>
              <dl className={styles.detailGrid}>
                <div><dt>Entitlement</dt><dd>{module.entitlement.active ? 'Active' : 'Not active'}</dd></div>
                <div><dt>Source</dt><dd>{module.entitlement.sourceType ?? '—'}{module.entitlement.sourceKey ? ` · ${module.entitlement.sourceKey}` : ''}</dd></div>
                <div><dt>Installation</dt><dd>{module.installationState ?? 'Not installed'}</dd></div>
                <div><dt>Route</dt><dd>{typeof module.manifest.route === 'string' ? module.manifest.route : '—'}</dd></div>
              </dl>
              <ModuleAction
                moduleKey={module.moduleKey}
                availability={module.availability}
                accountId={account.id}
                organizationId={organization.id}
                brandHref={brandHref}
              />
              {entitlementHistory.get(module.moduleKey) !== null ? (
                <EntitlementManager
                  moduleKey={module.moduleKey}
                  accountId={account.id}
                  organizationId={organization.id}
                  entitlements={entitlementHistory.get(module.moduleKey) ?? []}
                />
              ) : (
                <div className={styles.platformOnly}>Commercial entitlement is managed by Platform administration.</div>
              )}
            </article>
          );
        })}
      </section>
    </>
  );
}
