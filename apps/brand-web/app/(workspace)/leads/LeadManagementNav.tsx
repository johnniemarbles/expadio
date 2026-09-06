'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from '../workspace.module.css';

export type LeadNavKey =
  | 'leads'
  | 'contacts'
  | 'accounts'
  | 'demand-capture'
  | 'capture-config'
  | 'publications'
  | 'routing-rules';

interface LeadManagementNavProps {
  readonly activeKey?: LeadNavKey;
}

const PRIMARY_ITEMS = [
  { key: 'leads', label: 'Leads', href: '/leads' },
  { key: 'contacts', label: 'Contacts', href: '/leads/contacts' },
  { key: 'accounts', label: 'Accounts', href: '/leads/accounts' },
] as const;

const OPERATIONS_ITEMS = [
  { key: 'demand-capture', label: 'Demand Capture', href: '/leads/capture', desc: 'Full 19-stage governed journey' },
  { key: 'capture-config', label: 'Capture Config', href: '/leads/capture/configuration', desc: 'Form setup & offering builder' },
  { key: 'publications', label: 'Publications', href: '/leads/publications', desc: 'Channel attribution & hosted forms' },
  { key: 'routing-rules', label: 'Routing Rules', href: '/leads/capture/routing', desc: 'Governed lead assignment' },
] as const;

export function LeadManagementNav({ activeKey }: LeadManagementNavProps) {
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-close on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [dropdownOpen]);

  function isPrimaryActive(href: string): boolean {
    if (href === '/leads') return pathname === '/leads';
    return pathname.startsWith(href);
  }

  function isOperationsActive(): boolean {
    return OPERATIONS_ITEMS.some((item) => pathname.startsWith(item.href));
  }

  const operationsIsActive = isOperationsActive();

  return (
    <nav
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
      aria-label="Lead management navigation"
    >
      {/* Primary Tabs: Leads, Contacts, Accounts */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {PRIMARY_ITEMS.map((item) => {
          const active = isPrimaryActive(item.href);
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
                position: 'relative',
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
      </div>

      {/* Secondary Operations Dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          className={styles.secondaryButton}
          style={{
            height: 36,
            fontSize: 13,
            fontWeight: 600,
            padding: '0 14px',
            borderRadius: 'var(--radius-md, 4px)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            background: operationsIsActive
              ? 'color-mix(in srgb, var(--brand-primary, #FACC15) 15%, transparent)'
              : 'var(--card, #0A0A0A)',
            borderColor: operationsIsActive
              ? 'var(--brand-primary, #FACC15)'
              : dropdownOpen
              ? 'var(--foreground, #FAFAFA)'
              : 'var(--border, #272727)',
            color: operationsIsActive
              ? 'var(--brand-primary, #FACC15)'
              : 'var(--foreground, #FAFAFA)',
          }}
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
        >
          Operations
          <span
            style={{
              fontSize: 10,
              display: 'inline-block',
              transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s ease',
            }}
          >
            ▾
          </span>
        </button>

        {dropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 6,
              width: 260,
              background: 'var(--card, #0A0A0A)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-md, 6px)',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.85)',
              zIndex: 100,
              padding: '6px 0',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '8px 14px 4px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--muted-foreground, #A1A1AA)',
                borderBottom: '1px solid var(--border, #272727)',
                marginBottom: 4,
              }}
            >
              Operational & Capture Engine
            </div>

            {OPERATIONS_ITEMS.map((item) => {
              const active = pathname === item.href || (item.href !== '/leads/capture' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setDropdownOpen(false)}
                  style={{
                    display: 'block',
                    padding: '10px 14px',
                    textDecoration: 'none',
                    background: active
                      ? 'color-mix(in srgb, var(--brand-primary, #FACC15) 12%, transparent)'
                      : 'transparent',
                    borderLeft: active ? '3px solid var(--brand-primary, #FACC15)' : '3px solid transparent',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = 'var(--muted, #171717)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--brand-primary, #FACC15)' : 'var(--foreground, #FAFAFA)' }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', marginTop: 2 }}>
                    {item.desc}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
