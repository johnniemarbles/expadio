import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { listCrmAccounts, listCrmContacts } from '../../../../lib/brand-contacts';
import ContactsClient from './ContactsClient';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const context = await resolveBrandContext();
  const [contacts, accounts] = await withBrandTransaction(context, (client) =>
    Promise.all([
      listCrmContacts(client, { tenantId: context.tenantId }),
      listCrmAccounts(client, { tenantId: context.tenantId, organizationId: context.organizationId }),
    ])
  );

  return (
    <ContactsClient
      organizationName={context.organizationName ?? 'Brand Workspace'}
      contacts={contacts}
      accounts={accounts.map((a) => ({ accountId: a.accountId, name: a.name }))}
    />
  );
}
