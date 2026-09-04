import Link from 'next/link';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { listCrmAccounts } from '../../../../lib/brand-contacts';
import CreateAccountForm from './CreateAccountForm';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const context = await resolveBrandContext();
  const accounts = await withBrandTransaction(context, (client) =>
    listCrmAccounts(client, { tenantId: context.tenantId, organizationId: context.organizationId }),
  );

  return <>
    <section className={styles.pageHead}>
      <div>
        <p className={styles.eyebrow}>CRM · {context.organizationName}</p>
        <h1>Accounts</h1>
        <p>Companies and organizations in your CRM. Search before creating — duplicate accounts are merged automatically when leads convert.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className={styles.secondaryButton} href="/leads">Leads</Link>
        <Link className={styles.secondaryButton} href="/leads/contacts">Contacts</Link>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Create account</h2></div>
      <div className={styles.panelBody}>
        <CreateAccountForm />
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>All accounts</h2><span className={styles.pill}>{accounts.length}</span></div>
      {accounts.length === 0
        ? <div className={styles.empty}>No accounts yet. Accounts are created here or when a lead is converted to a customer.</div>
        : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Account</th><th>Stage</th><th>Location</th><th>Created</th></tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.accountId}>
                    <td>
                      <strong>{account.name}</strong>
                      {account.domain ? <><br /><small>{account.domain}</small></> : null}
                      {account.industry ? <><br /><small style={{ color: 'var(--theme-text-muted)' }}>{account.industry}</small></> : null}
                    </td>
                    <td><span className={styles.pill}>{account.lifecycleStage}</span></td>
                    <td>
                      {[account.city, account.countryCode].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td><small>{new Date(account.createdAt).toLocaleDateString()}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  </>;
}
