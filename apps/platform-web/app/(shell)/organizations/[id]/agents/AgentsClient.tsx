'use client';

import React, { useState, useMemo } from 'react';
import styles from '../../../../page.module.css';

interface CatalogCapability {
  capability_id: string;
  capability_key: string;
  display_name: string;
  department: string;
  description: string;
  permitted_modes: string[];
  enabled: boolean;
  binding_id: string | null;
  bound_status: string;
}

interface ToolGrant {
  tool_group: string;
  enabled: boolean;
}

function isBound(status: string) {
  const s = status.toUpperCase();
  return s === 'ACTIVE' || s === 'SUSPENDED' || s === 'PENDING_PROOF' || s === 'PLATFORM_DEFAULT';
}

function isActive(status: string) {
  return status.toUpperCase() === 'ACTIVE';
}

export function AgentsClient({ initialCatalog, initialTools, tenantId }: { initialCatalog: CatalogCapability[], initialTools: ToolGrant[], tenantId: string }) {
  const [catalog, setCatalog] = useState<CatalogCapability[]>(initialCatalog);
  const [tools, setTools] = useState<ToolGrant[]>(initialTools);
  const [working, setWorking] = useState<string | null>(null);
  
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogCapability[]>();
    for (const cap of catalog) {
      if (!map.has(cap.department)) map.set(cap.department, []);
      map.get(cap.department)!.push(cap);
    }
    return map;
  }, [catalog]);

  const refresh = async () => {
    const [resCat, resTools] = await Promise.all([
      fetch(`/api/agents/catalog?account=${tenantId}`),
      fetch(`/api/agents/tools?account=${tenantId}`)
    ]);
    if (resCat.ok) setCatalog(await resCat.json());
    if (resTools.ok) setTools(await resTools.json());
  };

  const bind = async (cap: CatalogCapability) => {
    setWorking(cap.capability_key);
    const res = await fetch(`/api/agents/bindings?account=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability_key: cap.capability_key }),
    });
    if (res.ok) await refresh();
    setWorking(null);
  };

  const toggle = async (cap: CatalogCapability) => {
    if (!cap.binding_id) return;
    setWorking(cap.capability_key);
    const action = isActive(cap.bound_status) ? 'suspend' : 'activate';
    const res = await fetch(`/api/agents/bindings?account=${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ binding_id: cap.binding_id, action }),
    });
    if (res.ok) await refresh();
    setWorking(null);
  };

  const toggleTool = async (toolGroup: string, currentlyEnabled: boolean) => {
    setWorking(toolGroup);
    const res = await fetch(`/api/agents/tools?account=${tenantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_group: toolGroup, enabled: !currentlyEnabled }),
    });
    if (res.ok) await refresh();
    setWorking(null);
  };

  const allTools = ['GitHub', 'FS', 'DB', 'Audit', 'Comms'];

  return (
    <>
      <section className={styles.panel} style={{ marginBottom: 20 }}>
        <div className={styles.panelHeading}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Tool Access Grants</h2>
        </div>
        <div style={{ padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {allTools.map(t => {
            const isEnabled = tools.find(x => x.tool_group === t)?.enabled ?? false;
            const busy = working === t;
            return (
              <button
                key={t}
                disabled={busy}
                onClick={() => toggleTool(t, isEnabled)}
                style={{
                  padding: '8px 16px', borderRadius: 'var(--theme-radius-card)', fontSize: 13, fontWeight: 700,
                  border: isEnabled ? '1px solid var(--theme-primary)' : '1px solid var(--theme-border)',
                  background: isEnabled ? 'color-mix(in srgb,var(--theme-primary) 10%,transparent)' : 'var(--theme-surface)',
                  color: isEnabled ? 'var(--theme-primary)' : 'var(--theme-text-secondary)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.5 : 1,
                }}
              >
                {t} {isEnabled ? '✓' : ''}
              </button>
            );
          })}
        </div>
      </section>

      {Array.from(grouped.entries()).map(([dept, caps]) => (
        <section key={dept} className={styles.panel} style={{ marginBottom: 16 }}>
          <div className={styles.panelHeading}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{dept} Agents</h2>
          </div>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {caps.map((cap) => {
              const bound = isBound(cap.bound_status);
              const active = isActive(cap.bound_status);
              const busy = working === cap.capability_key;
              return (
                <div key={cap.capability_key} style={{
                  padding: '14px 16px', borderRadius: "var(--theme-radius-card)",
                  border: `1px solid ${bound ? 'color-mix(in srgb,var(--theme-primary) 20%,var(--theme-border))' : 'var(--theme-border)'}`,
                  background: bound ? 'color-mix(in srgb,var(--theme-primary) 3%,var(--theme-surface))' : 'var(--theme-surface)',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                      background: active ? 'var(--theme-success)' : bound ? 'var(--theme-warning)' : 'var(--theme-text-muted)',
                    }} />
                    <strong style={{ fontSize: 13 }}>{cap.display_name}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                      disabled={busy}
                      onClick={() => (!bound ? bind(cap) : toggle(cap))}
                      style={{
                        padding: '5px 12px', borderRadius: "var(--theme-radius-card)", fontSize: 11, fontWeight: 700,
                        border: active 
                          ? `1px solid color-mix(in srgb,var(--theme-warning) 40%,var(--theme-border))`
                          : 'none',
                        background: active ? 'transparent' : 'var(--theme-primary)',
                        color: active ? 'var(--theme-warning)' : 'var(--theme-text-inverse)',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      {busy ? '…' : active ? 'Suspend' : 'Activate'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
