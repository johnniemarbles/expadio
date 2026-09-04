import Link from 'next/link';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { listCrmAccounts, listCrmContacts } from '../../../../lib/brand-contacts';
import CreateContactForm from './CreateContactForm';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const context = await resolveBrandContext();
  const [contacts, accounts] = await withBrandTransaction(context, (client) =>
    Promise.all([
      listCrmContacts(client, { tenantId: context.tenantId }),
      listCrmAccounts(client, { tenantId: context.tenantId, organizationId: context.organizationId }),
    ]),
  );

  return <>
    <section className={styles.pageHead}>
      <div>
        <p className={styles.eyebrow}>CRM · {context.organizationName}</p>
        <h1>Contacts</h1>
        <p>People in your CRM. Search by email or phone before adding — existing contacts are shown to prevent duplicates.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className={styles.secondaryButton} href="/leads">Leads</Link>
        <Link className={styles.secondaryButton} href="/leads/accounts">Accounts</Link>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Add contact</h2></div>
      <div className={styles.panelBody}>
        <CreateContactForm accounts={accounts.map((a) => ({ accountId: a.accountId, name: a.name }))} />
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>All contacts</h2><span className={styles.pill}>{contacts.length}</span></div>
      {contacts.length === 0
        ? <div className={styles.empty}>No contacts yet.</div>
        : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Contact</th><th>Account</th><th>Location</th><th>Added</th></tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.contactId}>
                    <td>
                      <strong>{contact.fullName}</strong>
                      {contact.title ? <><br /><small style={{ color: 'var(--theme-text-muted)' }}>{contact.title}</small></> : null}
                      {contact.email ? <><br /><small>{contact.email}</small></> : null}
                      {contact.phone ? <><br /><small>{contact.phone}</small></> : null}
                    </td>
                    <td>{contact.accountName ?? '—'}</td>
                    <td>{[contact.city, contact.regionOrState, contact.countryCode].filter(Boolean).join(', ') || '—'}</td>
                    <td><small>{new Date(contact.createdAt).toLocaleDateString()}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  </>;
}
