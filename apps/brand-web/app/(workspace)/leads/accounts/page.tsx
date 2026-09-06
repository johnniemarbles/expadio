import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { listCrmAccounts } from '../../../../lib/brand-contacts';
import AccountsClient from './AccountsClient';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const context = await resolveBrandContext();
  const accounts = await withBrandTransaction(context, (client) =>
    listCrmAccounts(client, { tenantId: context.tenantId, organizationId: context.organizationId })
  );

  return (
    <AccountsClient
      organizationName={context.organizationName ?? 'Brand Workspace'}
      accounts={accounts}
    />
  );
}
