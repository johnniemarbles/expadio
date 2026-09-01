import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { TenantAccessManager } from '../../../../components/TenantAccessManager/TenantAccessManager';
import { fetchApi, liveWorkspaceAdapter } from '../../../../lib/live-adapter';
import styles from './page.module.css';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export default async function TenantAccessPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const workspace = await liveWorkspaceAdapter.loadWorkspaceContext();
  const account = workspace.accounts.find((item) => item.id === one(params.account)) ?? workspace.accounts[0];
  const organizations = account
    ? workspace.organizations.filter((item) => account.allowedOrganizationIds.includes(item.id))
    : [];
  const organization = organizations.find((item) => item.id === one(params.org)) ?? organizations[0];

  if (!account || !organization) {
    return <section className={styles.notice}>No tenant workspace is available for access management.</section>;
  }

  const query = new URLSearchParams({ account: account.id, org: organization.id });
  const result = await fetchApi<any>(`/api/platform/tenant/access?${query}`);
  if (isDenied(result)) return <DeniedState result={result} />;

  return (
    <>
      <section className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Platform · Identity & access</p>
          <h1>Tenant users & access</h1>
          <p>
            Invite users, assign tenant roles, suspend access and revoke membership for
            {account.name} · {organization.name}. Brand consumes these assignments but cannot create them.
          </p>
        </div>
      </section>
      <TenantAccessManager
        accountId={account.id}
        organizationId={organization.id}
        members={result.members}
        invitations={result.invitations}
        roleKeys={result.roleKeys}
      />
    </>
  );
}
