'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MotionDrawer } from '@expadio/ui';
import CreateAccountForm from './CreateAccountForm';
import { LeadManagementNav } from '../LeadManagementNav';
import styles from '../../workspace.module.css';

interface AccountItem {
  accountId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  lifecycleStage: string;
  city: string | null;
  countryCode: string | null;
  createdAt: string;
}

interface AccountsClientProps {
  readonly organizationName: string;
  readonly accounts: readonly AccountItem[];
}

export default function AccountsClient({
  organizationName,
  accounts,
}: AccountsClientProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAccounts = accounts.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const name = a.name.toLowerCase();
    const domain = (a.domain ?? '').toLowerCase();
    const industry = (a.industry ?? '').toLowerCase();
    return name.includes(q) || domain.includes(q) || industry.includes(q);
  });

  return (
    <>
      {/* Header & Sub-Navigation */}
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>CRM · {organizationName}</p>
          <h1>Accounts</h1>
          <p>
            Companies and organizations in your CRM. Search before creating — accounts are automatically linked when leads convert.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Sub-Nav */}
          <LeadManagementNav activeKey="accounts" />

          {/* Primary "+ Create Account" Button */}
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className={styles.button}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 'var(--radius-md, 4px)',
              fontWeight: 600,
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            + Create Account
          </button>
        </div>
      </section>

      {/* Accounts Table Panel */}
      <section className={styles.panel} style={{ marginTop: 20, borderRadius: 'var(--radius-lg, 6px)' }}>
        <div
          className={styles.panelHead}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            padding: '16px 20px',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>All Accounts</h2>
            <span className={styles.pill}>{filteredAccounts.length}</span>
          </div>

          <input
            type="search"
            placeholder="Search by company name, domain, industry…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              height: 36,
              padding: '0 12px',
              borderRadius: 'var(--radius-md, 4px)',
              border: '1px solid var(--border, #272727)',
              background: 'var(--background, #000000)',
              color: 'var(--foreground, #FAFAFA)',
              fontSize: 13,
              minWidth: 260,
            }}
          />
        </div>

        {filteredAccounts.length === 0 ? (
          <div className={styles.empty} style={{ padding: '56px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground, #FAFAFA)', margin: '0 0 6px' }}>
              No accounts found
            </p>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: '0 0 20px' }}>
              {searchQuery ? `No accounts matching "${searchQuery}"` : 'Accounts are created here or when a lead converts.'}
            </p>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className={styles.button}
              style={{ height: 36, padding: '0 16px', borderRadius: 'var(--radius-md, 4px)', fontSize: 13 }}
            >
              + Create Account
            </button>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Stage</th>
                  <th>Location</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => (
                  <tr key={account.accountId}>
                    <td>
                      <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{account.name}</strong>
                      {account.domain ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>{account.domain}</small>
                        </>
                      ) : null}
                      {account.industry ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>{account.industry}</small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span className={styles.pill}>{account.lifecycleStage}</span>
                    </td>
                    <td>
                      {[account.city, account.countryCode].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td>
                      <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>
                        {new Date(account.createdAt).toLocaleDateString()}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Translucent Backdrop Blur Overlay */}
      {isCreateOpen ? (
        <div
          onClick={() => setIsCreateOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 99,
          }}
          aria-hidden="true"
        />
      ) : null}

      {/* Slide-over Drawer Modal */}
      <MotionDrawer
        open={isCreateOpen}
        side="right"
        style={{
          width: '100%',
          maxWidth: 540,
          background: 'var(--card, #0A0A0A)',
          borderLeft: '1px solid var(--border, #272727)',
          borderRadius: 'var(--radius-xl, 8px) 0 0 var(--radius-xl, 8px)',
          boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'fixed',
          top: 0,
          right: 0,
          zIndex: 100,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border, #272727)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--background, #000000)',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground, #FAFAFA)' }}>
            Create New Account
          </h2>
          <button
            type="button"
            onClick={() => setIsCreateOpen(false)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-md, 4px)',
              color: 'var(--muted-foreground, #A1A1AA)',
              fontSize: 16,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 24, flex: 1, overflowY: 'auto' }}>
          <CreateAccountForm onCreated={() => setIsCreateOpen(false)} />
        </div>
      </MotionDrawer>
    </>
  );
}
