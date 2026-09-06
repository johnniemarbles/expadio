'use client';

import { useEffect, useRef, useState } from 'react';

export type BrainTabKey = 'overview' | 'missions' | 'observations' | 'corrections' | 'provenance';

export interface PrimaryTabItem {
  id: BrainTabKey;
  label: string;
  badge?: number;
}

export interface MoreMenuItem {
  id: BrainTabKey;
  label: string;
  desc?: string;
  badge?: number;
}

const PRIMARY_ITEMS: PrimaryTabItem[] = [
  { id: 'overview', label: 'Intelligence Overview' },
  { id: 'missions', label: 'Executive Missions' },
  { id: 'observations', label: 'Observations' },
];

const MORE_ITEMS: MoreMenuItem[] = [
  { id: 'corrections', label: 'Memory Corrections', desc: 'Human-in-the-loop intelligence overrides' },
  { id: 'provenance', label: 'Evidence Provenance', desc: 'Audit chain & model source telemetry' },
];

export function BrainNav({
  activeTab = 'overview',
  onTabChange,
  onOpenSpawnMission,
}: {
  readonly activeTab?: BrainTabKey;
  readonly onTabChange?: (tab: BrainTabKey) => void;
  readonly onOpenSpawnMission?: () => void;
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
        borderBottom: '1px solid var(--border, #272727)',
        paddingBottom: 0,
        marginBottom: 20,
        marginTop: 16,
        width: '100%',
      }}
      aria-label="Brand brain top navigation"
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
                  color: active ? 'var(--foreground, #FAFAFA)' : 'var(--muted-foreground, #A1A1AA)',
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--brand-primary, #FACC15)' : '2px solid transparent',
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
              borderRadius: 'var(--radius-md, 4px)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              background: isMoreActive
                ? 'color-mix(in srgb, var(--brand-primary, #FACC15) 15%, transparent)'
                : 'var(--card, #0A0A0A)',
              border: isMoreActive
                ? '1px solid var(--brand-primary, #FACC15)'
                : '1px solid var(--border, #272727)',
              color: isMoreActive
                ? 'var(--brand-primary, #FACC15)'
                : 'var(--foreground, #FAFAFA)',
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
                Intelligence Audit & Ops
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
                        ? 'color-mix(in srgb, var(--brand-primary, #FACC15) 12%, transparent)'
                        : 'transparent',
                      border: 'none',
                      borderLeft: active ? '3px solid var(--brand-primary, #FACC15)' : '3px solid transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = 'var(--muted, #171717)';
                    }}
                    onMouseLeave={(e) => {
                      if (!active) e.currentTarget.style.background = 'transparent';
                    }}
                  >
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
                      <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)' }}>
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
        {onOpenSpawnMission && (
          <button
            type="button"
            onClick={onOpenSpawnMission}
            style={{
              height: 36,
              fontSize: 13,
              fontWeight: 700,
              padding: '0 16px',
              borderRadius: 'var(--radius-md, 4px)',
              background: 'var(--brand-primary, #FACC15)',
              color: '#000000',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            + Spawn Executive Mission
          </button>
        )}
      </div>
    </nav>
  );
}
