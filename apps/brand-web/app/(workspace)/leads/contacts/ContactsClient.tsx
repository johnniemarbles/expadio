'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MotionDrawer } from '@expadio/ui';
import CreateContactForm from './CreateContactForm';
import { LeadManagementNav } from '../LeadManagementNav';
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
          <LeadManagementNav activeKey="contacts" />

          {/* Primary "+ Create Contact" Button */}
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
            + Create Contact
          </button>
        </div>
      </section>

      {/* Main Table Panel */}
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
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>All Contacts</h2>
            <span className={styles.pill}>{filteredContacts.length}</span>
          </div>

          <input
            type="search"
            placeholder="Search by name, email, phone…"
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

        {filteredContacts.length === 0 ? (
          <div className={styles.empty} style={{ padding: '56px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground, #FAFAFA)', margin: '0 0 6px' }}>
              No contacts found
            </p>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: '0 0 20px' }}>
              {searchQuery ? `No contacts matching "${searchQuery}"` : 'Get started by creating your first contact.'}
            </p>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className={styles.button}
              style={{ height: 36, padding: '0 16px', borderRadius: 'var(--radius-md, 4px)', fontSize: 13 }}
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
                      <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{contact.fullName}</strong>
                      {contact.title ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>{contact.title}</small>
                        </>
                      ) : null}
                      {contact.email ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>{contact.email}</small>
                        </>
                      ) : null}
                      {contact.phone ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>{contact.phone}</small>
                        </>
                      ) : null}
                    </td>
                    <td>{contact.accountName ?? '—'}</td>
                    <td>
                      {[contact.city, contact.regionOrState, contact.countryCode].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td>
                      <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>
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
            background: 'rgba(0, 0, 0, 0.75)',
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
            Create New Contact
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
          <CreateContactForm accounts={accounts} onCreated={() => setIsCreateOpen(false)} />
        </div>
      </MotionDrawer>
    </>
  );
}
