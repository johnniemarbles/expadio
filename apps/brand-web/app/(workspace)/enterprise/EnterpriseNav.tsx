'use client';

import { useEffect, useRef, useState } from 'react';

export type EnterpriseTabKey = 'overview' | 'legal' | 'plans' | 'requests' | 'governance';

export interface PrimaryTabItem {
  id: EnterpriseTabKey;
  label: string;
  badge?: number;
}

export interface MoreMenuItem {
  id: EnterpriseTabKey;
  label: string;
  desc?: string;
  badge?: number;
}

const PRIMARY_ITEMS: PrimaryTabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'legal', label: 'Legal Entities' },
  { id: 'plans', label: 'Plans & Setup' },
];

const MORE_ITEMS: MoreMenuItem[] = [
  { id: 'requests', label: 'Capability Requests', desc: 'Enterprise feature entitlement & scope requests' },
  { id: 'governance', label: 'Jurisdictions & Authority', desc: 'Commercial appointments & territory grants' },
];

export function EnterpriseNav({
  activeTab = 'overview',
  onTabChange,
  onOpenOnboardEntity,
}: {
  readonly activeTab?: EnterpriseTabKey;
  readonly onTabChange?: (tab: EnterpriseTabKey) => void;
  readonly onOpenOnboardEntity?: () => void;
}) {
  const [openMore, setOpenMore] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMore) return;
    function handleOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenMore(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [openMore]);

  const isMoreActive = MORE_ITEMS.some((item) => item.id === activeTab);

  return (
    <nav
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        borderBottom: '1px solid var(--border)',
        paddingBottom: 0,
        marginBottom: 20,
        marginTop: 16,
        width: '100%',
      }}
      aria-label="Enterprise control plane top navigation"
    >
      {/* Left side: Primary Tabs & More Dropdown */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }} role="tablist">
          {PRIMARY_ITEMS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTabChange?.(tab.id)}
                style={{
                  height: 42,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--brand-primary)' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  padding: '0 2px',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* More Dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setOpenMore((prev) => !prev)}
            style={{
              height: 34,
              fontSize: 13,
              fontWeight: 600,
              padding: '0 12px',
              borderRadius: 'var(--radius-md)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              background: isMoreActive
                ? 'color-mix(in srgb, var(--brand-primary) 15%, transparent)'
                : 'var(--card)',
              border: isMoreActive
                ? '1px solid var(--brand-primary)'
                : '1px solid var(--border)',
              color: isMoreActive
                ? 'var(--brand-primary)'
                : 'var(--foreground)',
            }}
            aria-expanded={openMore}
            aria-haspopup="true"
          >
            More
            <span
              style={{
                fontSize: 10,
                display: 'inline-block',
                transform: openMore ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
              }}
            >
              ▾
            </span>
          </button>

          {openMore && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 6,
                width: 270,
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
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
                  color: 'var(--muted-foreground)',
                  borderBottom: '1px solid var(--border)',
                  marginBottom: 4,
                }}
              >
                Enterprise Governance
              </div>

              {MORE_ITEMS.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onTabChange?.(item.id);
                      setOpenMore(false);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      padding: '10px 14px',
                      background: active
                        ? 'color-mix(in srgb, var(--brand-primary) 12%, transparent)'
                        : 'transparent',
                      border: 'none',
                      borderLeft: active ? '3px solid var(--brand-primary)' : '3px solid transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = 'var(--muted)';
                    }}
                    onMouseLeave={(e) => {
                      if (!active) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: active ? 'var(--brand-primary)' : 'var(--foreground)',
                      }}
                    >
                      {item.label}
                    </div>
                    {item.desc ? (
                      <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                        {item.desc}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right side: Primary CTA */}
      <div>
        {onOpenOnboardEntity && (
          <button
            type="button"
            onClick={onOpenOnboardEntity}
            style={{
              height: 36,
              fontSize: 13,
              fontWeight: 700,
              padding: '0 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--brand-primary)',
              color: 'var(--card)',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            + Onboard Legal Entity
          </button>
        )}
      </div>
    </nav>
  );
}
