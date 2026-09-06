'use client';

import React, { useState, useMemo } from 'react';
import styles from '../page.module.css';

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

function isBound(status: string) {
  const s = status.toUpperCase();
  return s === 'ACTIVE' || s === 'SUSPENDED' || s === 'PENDING_PROOF' || s === 'PLATFORM_DEFAULT';
}

function isActive(status: string) {
  const s = status.toUpperCase();
  return s === 'ACTIVE';
}

export function CatalogClient({ initial }: { initial: CatalogCapability[] }) {
  const [catalog, setCatalog] = useState<CatalogCapability[]>(initial);
  const [search, setSearch] = useState('');
  const [activeDept, setActiveDept] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  const departments = useMemo(() => {
    const set = new Set(catalog.map((c) => c.department));
    return Array.from(set).sort();
  }, [catalog]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return catalog.filter((c) =>
      (!activeDept || c.department === activeDept) &&
      (!q || c.display_name.toLowerCase().includes(q) ||
             c.capability_key.toLowerCase().includes(q) ||
             c.description.toLowerCase().includes(q) ||
             c.department.toLowerCase().includes(q))
    );
  }, [catalog, search, activeDept]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogCapability[]>();
    for (const cap of filtered) {
      if (!map.has(cap.department)) map.set(cap.department, []);
      map.get(cap.department)!.push(cap);
    }
    return map;
  }, [filtered]);

  const refresh = async () => {
    const res = await fetch('/api/agents/catalog');
    if (res.ok) setCatalog(await res.json());
  };

  const bind = async (cap: CatalogCapability) => {
    setWorking(cap.capability_id);
    const res = await fetch('/api/agents/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability_key: cap.capability_key }),
    });
    if (res.ok) {
      setNotice({ msg: `${cap.display_name} activated for this tenant.`, kind: 'ok' });
      await refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setNotice({ msg: j.error ?? 'Failed to activate.', kind: 'err' });
    }
    setWorking(null);
  };

  const toggle = async (cap: CatalogCapability) => {
    if (!cap.binding_id) return;
    setWorking(cap.capability_id);
    const action = isActive(cap.bound_status) ? 'suspend' : 'activate';
    const res = await fetch('/api/agents/bindings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ binding_id: cap.binding_id, action }),
    });
    if (res.ok) {
      setNotice({ msg: `Agent ${action}d.`, kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to update status.', kind: 'err' });
    }
    setWorking(null);
  };

  const activeCount = catalog.filter((c) => isActive(c.bound_status)).length;
  const boundCount = catalog.filter((c) => isBound(c.bound_status)).length;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="catalog-title">
        <div>
          <p className={styles.eyebrow}>Agent Intelligence</p>
          <h1 id="catalog-title">Agent Catalog</h1>
          <p>
            Browse all {catalog.length} agents across {departments.length} departments.{' '}
            {boundCount} bound · {activeCount} active for this tenant.
          </p>
        </div>
      </section>

      {notice && (
        <div style={{
          padding: '10px 14px', borderRadius: "var(--theme-radius-card)", fontSize: 13, marginBottom: 16,
          background: notice.kind === 'err'
            ? 'color-mix(in srgb,var(--theme-danger) 8%,var(--theme-surface))'
            : 'color-mix(in srgb,var(--theme-success) 8%,var(--theme-surface))',
          border: `1px solid ${notice.kind === 'err' ? 'var(--theme-danger)' : 'var(--theme-success)'}`,
          color: notice.kind === 'err' ? 'var(--theme-danger)' : 'var(--theme-success)',
        }}>
          {notice.msg}
          <button onClick={() => setNotice(null)} style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* Search + department filter */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents…"
          style={{
            flex: '1 1 240px', padding: '9px 14px', borderRadius: "var(--theme-radius-card)", fontSize: 13,
            border: '1px solid var(--theme-border)', background: 'var(--theme-surface)',
            color: 'var(--theme-text-primary)', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveDept(null)}
            style={{
              padding: '6px 14px', borderRadius: "var(--theme-radius-card)", fontSize: 11, fontWeight: 700, border: 'none',
              cursor: 'pointer',
              background: !activeDept ? 'var(--theme-primary)' : 'var(--theme-surface-muted)',
              color: !activeDept ? 'var(--theme-text-inverse)' : 'var(--theme-text-secondary)',
            }}
          >
            All
          </button>
          {departments.map((dept) => (
            <button
              key={dept}
              onClick={() => setActiveDept(activeDept === dept ? null : dept)}
              style={{
                padding: '6px 14px', borderRadius: "var(--theme-radius-card)", fontSize: 11, fontWeight: 700, border: 'none',
                cursor: 'pointer',
                background: activeDept === dept ? 'var(--theme-primary)' : 'var(--theme-surface-muted)',
                color: activeDept === dept ? 'var(--theme-text-inverse)' : 'var(--theme-text-secondary)',
              }}
            >
              {dept}
            </button>
          ))}
        </div>
      </div>

      {/* Department sections */}
      {Array.from(grouped.entries()).map(([dept, caps]) => (
        <section key={dept} style={{ marginBottom: 28 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
            paddingBottom: 8, borderBottom: '1px solid var(--theme-border)',
          }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--theme-text-muted)' }}>
              {dept}
            </h2>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: "var(--theme-radius-card)",
              background: 'var(--theme-surface-muted)', color: 'var(--theme-text-muted)',
            }}>
              {caps.length} agent{caps.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {caps.map((cap) => {
              const bound = isBound(cap.bound_status);
              const active = isActive(cap.bound_status);
              const busy = working === cap.capability_id;
              return (
                <div key={cap.capability_id} style={{
                  padding: '14px 16px', borderRadius: "var(--theme-radius-card)",
                  border: `1px solid ${bound ? 'color-mix(in srgb,var(--theme-primary) 20%,var(--theme-border))' : 'var(--theme-border)'}`,
                  background: bound ? 'color-mix(in srgb,var(--theme-primary) 3%,var(--theme-surface))' : 'var(--theme-surface)',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                          background: active ? 'var(--theme-success)' : bound ? 'var(--theme-warning)' : 'var(--theme-text-muted)',
                        }} />
                        <strong style={{ fontSize: 13 }}>{cap.display_name || cap.capability_key}</strong>
                        {bound && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: "var(--theme-radius-card)",
                            background: active
                              ? 'color-mix(in srgb,var(--theme-success) 12%,transparent)'
                              : 'color-mix(in srgb,var(--theme-warning) 12%,transparent)',
                            color: active ? 'var(--theme-success)' : 'var(--theme-warning)',
                            border: `1px solid ${active
                              ? 'color-mix(in srgb,var(--theme-success) 28%,var(--theme-border))'
                              : 'color-mix(in srgb,var(--theme-warning) 28%,var(--theme-border))'}`,
                          }}>
                            {cap.bound_status}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--theme-text-muted)', marginTop: 2, fontFamily: 'var(--theme-font-mono)' }}>
                        {cap.capability_key}
                      </div>
                    </div>
                  </div>
                  {cap.description && (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--theme-text-secondary)', lineHeight: 1.5 }}>
                      {cap.description}
                    </p>
                  )}
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

      {grouped.size === 0 && (
        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: 13 }}>
          {search ? `No agents match "${search}"` : 'No agents in catalog yet.'}
        </div>
      )}
    </>
  );
}
