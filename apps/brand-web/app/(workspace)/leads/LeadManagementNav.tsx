'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type LeadNavKey =
  | 'leads'
  | 'contacts'
  | 'accounts'
  | 'demand-capture'
  | 'capture-config'
  | 'publications'
  | 'routing-rules';

export interface PrimaryTabItem {
  id: string;
  label: string;
  href: string;
  badge?: number;
}

export interface OperationsMenuItem {
  id: string;
  label: string;
  href: string;
  desc?: string;
  badge?: number;
}

const PRIMARY_ITEMS: PrimaryTabItem[] = [
  { id: 'leads', label: 'Leads', href: '/leads' },
  { id: 'contacts', label: 'Contacts', href: '/leads/contacts' },
  { id: 'accounts', label: 'Accounts', href: '/leads/accounts' },
];

const OPERATIONS_ITEMS: OperationsMenuItem[] = [
  { id: 'demand-capture', label: 'Demand Capture', href: '/leads/capture', desc: 'Full 19-stage governed intake journey' },
  { id: 'capture-config', label: 'Capture Config', href: '/leads/capture/configuration', desc: 'Form setup & offering builder' },
  { id: 'publications', label: 'Publications', href: '/leads/publications', desc: 'Channel attribution & hosted forms' },
  { id: 'routing-rules', label: 'Routing Rules', href: '/leads/capture/routing', desc: 'Governed lead assignment' },
];

export function PrimaryTabs({
  items = PRIMARY_ITEMS,
}: {
  readonly items?: PrimaryTabItem[];
}) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === '/leads') return pathname === '/leads';
    return pathname.startsWith(href);
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 28,
        alignItems: 'center',
      }}
      role="tablist"
      aria-label="Primary lead navigation"
    >
      {items.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            role="tab"
            aria-selected={active}
            style={{
              height: 42,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 14,
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--foreground, #FAFAFA)' : 'var(--muted-foreground, #A1A1AA)',
              textDecoration: 'none',
              borderBottom: active ? '2px solid var(--brand-primary, #FACC15)' : '2px solid transparent',
              transition: 'all 0.15s ease',
              padding: '0 2px',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 10,
                  background: active ? 'var(--brand-primary, #FACC15)' : 'var(--muted, #272727)',
                  color: active ? '#000000' : 'var(--foreground, #FAFAFA)',
                }}
              >
                {tab.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

export function OperationsMenu({
  items = OPERATIONS_ITEMS,
  unassignedCount,
}: {
  readonly items?: OperationsMenuItem[];
  readonly unassignedCount?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const isOperationsActive = items.some((item) =>
    item.href === '/leads/capture'
      ? pathname === '/leads/capture'
      : pathname.startsWith(item.href)
  );

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
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
          background: isOperationsActive
            ? 'color-mix(in srgb, var(--brand-primary, #FACC15) 15%, transparent)'
            : 'var(--card, #0A0A0A)',
          border: isOperationsActive
            ? '1px solid var(--brand-primary, #FACC15)'
            : '1px solid var(--border, #272727)',
          color: isOperationsActive
            ? 'var(--brand-primary, #FACC15)'
            : 'var(--foreground, #FAFAFA)',
        }}
        aria-expanded={open}
        aria-haspopup="true"
      >
        Operations
        {unassignedCount != null && unassignedCount > 0 ? (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 8,
              background: 'var(--brand-primary, #FACC15)',
              color: '#000000',
            }}
          >
            {unassignedCount}
          </span>
        ) : null}
        <span
          style={{
            fontSize: 10,
            display: 'inline-block',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            width: 270,
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

          {items.map((item) => {
            const active =
              item.href === '/leads/capture'
                ? pathname === '/leads/capture'
                : pathname.startsWith(item.href);
            const badgeValue = item.id === 'demand-capture' ? unassignedCount ?? item.badge : item.badge;

            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => setOpen(false)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
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
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: active ? 'var(--brand-primary, #FACC15)' : 'var(--foreground, #FAFAFA)',
                    }}
                  >
                    {item.label}
                  </div>
                  {item.desc ? (
                    <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', marginTop: 2 }}>
                      {item.desc}
                    </div>
                  ) : null}
                </div>

                {badgeValue != null && badgeValue > 0 ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 10,
                      background: 'var(--brand-primary, #FACC15)',
                      color: '#000000',
                      marginLeft: 8,
                      flexShrink: 0,
                    }}
                  >
                    {badgeValue}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LeadManagementNav({
  activeKey,
  unassignedCount,
}: {
  readonly activeKey?: LeadNavKey;
  readonly unassignedCount?: number;
}) {
  return (
    <nav
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        borderBottom: '1px solid var(--border, #272727)',
        paddingBottom: 0,
        marginTop: 16,
        width: '100%',
      }}
      aria-label="Lead management top navigation"
    >
      <PrimaryTabs />
      <OperationsMenu unassignedCount={unassignedCount} />
    </nav>
  );
}
