'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MotionDrawer } from '@expadio/ui';
import CreateContactForm from './CreateContactForm';
import styles from '../../workspace.module.css';

interface AccountOption {
  accountId: string;
  name: string;
}

interface ContactItem {
  contactId: string;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  accountName: string | null;
  city: string | null;
  regionOrState: string | null;
  countryCode: string | null;
  createdAt: string;
}

interface ContactsClientProps {
  readonly organizationName: string;
  readonly contacts: readonly ContactItem[];
  readonly accounts: readonly AccountOption[];
}

export default function ContactsClient({
  organizationName,
  contacts,
  accounts,
}: ContactsClientProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredContacts = contacts.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const name = c.fullName.toLowerCase();
    const email = (c.email ?? '').toLowerCase();
    const phone = (c.phone ?? '').toLowerCase();
    const account = (c.accountName ?? '').toLowerCase();
    return name.includes(q) || email.includes(q) || phone.includes(q) || account.includes(q);
  });

  return (
    <>
      {/* Page Header & Navigation */}
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>CRM · {organizationName}</p>
          <h1>Contacts</h1>
          <p>
            People in your CRM. Search by name, email, or phone before adding to prevent duplicates.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Sub-Navigation */}
          <nav
            style={{
              display: 'flex',
              gap: 4,
              padding: 4,
              background: 'var(--theme-surface-raised, #0D0E11)',
              borderRadius: 'var(--theme-radius-card, 8px)',
              border: '1px solid var(--theme-border, #1F242D)',
              width: 'fit-content',
              flexWrap: 'nowrap',
            }}
            aria-label="Lead management navigation"
          >
            <Link
              className={styles.secondaryButton}
              style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 14px' }}
              href="/leads"
            >
              Leads
            </Link>
            <Link
              className={styles.button}
              style={{ height: 32, fontSize: 12, padding: '0 14px', whiteSpace: 'nowrap' }}
              href="/leads/contacts"
            >
              Contacts
            </Link>
            <Link
              className={styles.secondaryButton}
              style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 14px' }}
              href="/leads/accounts"
            >
              Accounts
            </Link>
          </nav>

          {/* Primary "+ Create Contact" Button */}
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className={styles.button}
            style={{
              height: 40,
              padding: '0 20px',
              fontWeight: 700,
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 8px rgba(250, 204, 21, 0.2)',
            }}
          >
            + Create Contact
          </button>
        </div>
      </section>

      {/* Main Table Panel */}
      <section className={styles.panel} style={{ marginTop: 20 }}>
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
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>All Contacts</h2>
            <span className={styles.pill}>{filteredContacts.length}</span>
          </div>

          <input
            type="search"
            placeholder="Search by name, email, phone…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '7px 12px',
              borderRadius: 'var(--theme-radius-control, 6px)',
              border: '1px solid var(--theme-border, #1F242D)',
              background: 'var(--theme-surface, #060707)',
              color: 'var(--theme-text-primary, #FFFFFF)',
              fontSize: 13,
              minWidth: 260,
            }}
          />
        </div>

        {filteredContacts.length === 0 ? (
          <div className={styles.empty} style={{ padding: '56px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--theme-text-primary, #FFFFFF)', margin: '0 0 6px' }}>
              No contacts found
            </p>
            <p style={{ fontSize: 13, color: 'var(--theme-text-muted, #9CA3AF)', margin: '0 0 20px' }}>
              {searchQuery ? `No contacts matching "${searchQuery}"` : 'Get started by creating your first contact.'}
            </p>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className={styles.button}
              style={{ padding: '8px 20px', fontSize: 13 }}
            >
              + Create Contact
            </button>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Account</th>
                  <th>Location</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((contact) => (
                  <tr key={contact.contactId}>
                    <td>
                      <strong style={{ color: 'var(--theme-text-primary, #FFFFFF)' }}>{contact.fullName}</strong>
                      {contact.title ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--theme-text-muted, #9CA3AF)' }}>{contact.title}</small>
                        </>
                      ) : null}
                      {contact.email ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--theme-text-muted, #9CA3AF)' }}>{contact.email}</small>
                        </>
                      ) : null}
                      {contact.phone ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--theme-text-muted, #9CA3AF)' }}>{contact.phone}</small>
                        </>
                      ) : null}
                    </td>
                    <td>{contact.accountName ?? '—'}</td>
                    <td>
                      {[contact.city, contact.regionOrState, contact.countryCode].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td>
                      <small style={{ color: 'var(--theme-text-muted, #9CA3AF)' }}>
                        {new Date(contact.createdAt).toLocaleDateString()}
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
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 99,
          }}
          aria-hidden="true"
        />
      ) : null}

      {/* Right Slide-over Drawer Modal */}
      <MotionDrawer
        open={isCreateOpen}
        side="right"
        style={{
          width: '100%',
          maxWidth: 540,
          background: 'var(--theme-surface-raised, #0D0E11)',
          borderLeft: '1px solid var(--theme-border, #1F242D)',
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
            borderBottom: '1px solid var(--theme-border, #1F242D)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--theme-surface, #060707)',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--theme-text-primary, #FFFFFF)' }}>
            Create New Contact
          </h2>
          <button
            type="button"
            onClick={() => setIsCreateOpen(false)}
            style={{
              background: 'transparent',
              border: '1px solid var(--theme-border, #1F242D)',
              borderRadius: 6,
              color: 'var(--theme-text-muted, #9CA3AF)',
              fontSize: 18,
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
          <CreateContactForm accounts={accounts} onCreated={() => setIsCreateOpen(false)} />
        </div>
      </MotionDrawer>
    </>
  );
}
