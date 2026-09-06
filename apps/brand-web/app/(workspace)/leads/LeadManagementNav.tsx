'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './workspace.module.css';

export type LeadNavKey =
  | 'leads'
  | 'contacts'
  | 'accounts'
  | 'capture-config'
  | 'publications'
  | 'demand-capture';

interface LeadManagementNavProps {
  readonly activeKey?: LeadNavKey;
}

const NAV_ITEMS: { key: LeadNavKey; label: string; href: string }[] = [
  { key: 'leads', label: 'Leads', href: '/leads' },
  { key: 'contacts', label: 'Contacts', href: '/leads/contacts' },
  { key: 'accounts', label: 'Accounts', href: '/leads/accounts' },
  { key: 'capture-config', label: 'Capture Config', href: '/leads/capture/configuration' },
  { key: 'publications', label: 'Publications', href: '/leads/publications' },
  { key: 'demand-capture', label: 'Demand Capture', href: '/leads/capture' },
];

export function LeadManagementNav({ activeKey }: LeadManagementNavProps) {
  const pathname = usePathname();

  function isItemActive(item: (typeof NAV_ITEMS)[number]): boolean {
    if (activeKey) return activeKey === item.key;
    if (item.href === '/leads') return pathname === '/leads';
    return pathname.startsWith(item.href);
  }

  return (
    <nav
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
      aria-label="Lead management section navigation"
    >
      {NAV_ITEMS.map((item) => {
        const active = isItemActive(item);
        return (
          <Link
            key={item.key}
            href={item.href}
            className={active ? styles.button : styles.secondaryButton}
            style={{
              height: 36,
              fontSize: 13,
              fontWeight: 600,
              padding: '0 16px',
              borderRadius: 'var(--radius-md, 4px)',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              transition: 'all 0.15s ease',
              ...(active
                ? {
                    background: 'var(--brand-primary, #FACC15)',
                    color: '#000000',
                    border: '1px solid var(--brand-primary, #FACC15)',
                    boxShadow: '0 2px 8px color-mix(in srgb, var(--brand-primary, #FACC15) 25%, transparent)',
                  }
                : {
                    background: 'var(--card, #0A0A0A)',
                    border: '1px solid var(--border, #272727)',
                    color: 'var(--foreground, #FAFAFA)',
                  }),
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
