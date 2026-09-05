'use client';

import React, { useState, useMemo } from 'react';
import styles from '../../workspace.module.css';

interface Binding {
  binding_id: string;
  capability_key: string;
  display_name: string;
  department: string;
  description: string;
  status: string;
  mapped_to_resource: string;
  created_at: string;
}

function isActive(status: string) {
  const s = status.toUpperCase();
  return s === 'ACTIVE' || s === 'BOUND';
}

export function AgentsClient({ initial }: { initial: Binding[] }) {
  const [bindings, setBindings] = useState<Binding[]>(initial);
  const [working, setWorking] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeDept, setActiveDept] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  const departments = useMemo(() => {
    const set = new Set(bindings.map((b) => b.department || 'General'));
    return Array.from(set).sort();
  }, [bindings]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return bindings.filter((b) =>
      (!activeDept || (b.department || 'General') === activeDept) &&
      (!q || (b.display_name || b.capability_key).toLowerCase().includes(q) ||
              b.capability_key.toLowerCase().includes(q) ||
              (b.department || '').toLowerCase().includes(q) ||
              (b.description || '').toLowerCase().includes(q))
    );
  }, [bindings, search, activeDept]);

  const grouped = useMemo(() => {
    const map = new Map<string, Binding[]>();
    for (const b of filtered) {
      const dept = b.department || 'General';
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(b);
    }
    return map;
  }, [filtered]);

  const refresh = async () => {
    const res = await fetch('/api/agents');
    if (res.ok) setBindings(await res.json());
  };

  const toggle = async (b: Binding) => {
    setWorking(b.binding_id);
    const action = isActive(b.status) ? 'suspend' : 'activate';
    const res = await fetch(`/api/agents/${encodeURIComponent(b.binding_id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      setNotice({ msg: `${b.display_name || b.capability_key} ${action}d.`, kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to update agent status.', kind: 'err' });
    }
    setWorking(null);
  };

  const remove = async (b: Binding) => {
    if (!confirm(`Remove "${b.display_name || b.capability_key}"? This cannot be undone.`)) return;
    setWorking(b.binding_id);
    const res = await fetch(`/api/agents?id=${encodeURIComponent(b.binding_id)}`, { method: 'DELETE' });
    if (res.ok) {
      setNotice({ msg: 'Agent removed.', kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to remove agent.', kind: 'err' });
    }
    setWorking(null);
  };

  const activeCount = bindings.filter((b) => isActive(b.status)).length;

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Workspace Settings</p>
          <h1>AI Agents</h1>
          <p>
            {bindings.length} agent{bindings.length !== 1 ? 's' : ''} available to this workspace
            · {activeCount} active. Contact your platform administrator to add new agents.
          </p>
        </div>
      </section>

      {notice && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16,
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

      {bindings.length === 0 ? (
        <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--theme-text-secondary)', fontSize: 14 }}>
          No AI agents are available for this workspace yet. Contact your platform administrator to configure agent access.
        </div>
      ) : (
        <>
          {/* Search + department filter */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents…"
              style={{
                flex: '1 1 220px', padding: '9px 14px', borderRadius: 8, fontSize: 13,
                border: '1px solid var(--theme-border)', background: 'var(--theme-surface)',
                color: 'var(--theme-text-primary)', outline: 'none',
              }}
            />
            {departments.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  onClick={() => setActiveDept(null)}
                  style={{
                    padding: '6px 14px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                    background: !activeDept ? 'var(--theme-primary)' : 'var(--theme-surface-muted)',
                    color: !activeDept ? 'var(--theme-text-inverse)' : 'var(--theme-text-secondary)',
                  }}
                >All departments</button>
                {departments.map((dept) => (
                  <button
                    key={dept}
                    onClick={() => setActiveDept(activeDept === dept ? null : dept)}
                    style={{
                      padding: '6px 14px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                      background: activeDept === dept ? 'var(--theme-primary)' : 'var(--theme-surface-muted)',
                      color: activeDept === dept ? 'var(--theme-text-inverse)' : 'var(--theme-text-secondary)',
                    }}
                  >{dept}</button>
                ))}
              </div>
            )}
          </div>

          {/* Department-grouped cards */}
          {Array.from(grouped.entries()).map(([dept, items]) => (
            <section key={dept} style={{ marginBottom: 24 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
                paddingBottom: 8, borderBottom: '1px solid var(--theme-border)',
              }}>
                <h2 style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--theme-text-muted)' }}>
                  {dept}
                </h2>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                  background: 'var(--theme-surface-muted)', color: 'var(--theme-text-muted)',
                }}>
                  {items.length}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {items.map((b) => {
                  const active = isActive(b.status);
                  const busy = working === b.binding_id;
                  return (
                    <div key={b.binding_id} style={{
                      padding: '14px 16px', borderRadius: 10,
                      border: `1px solid ${active ? 'color-mix(in srgb,var(--theme-success) 22%,var(--theme-border))' : 'var(--theme-border)'}`,
                      background: 'var(--theme-surface)',
                      display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{
                              width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                              background: active ? 'var(--theme-success)' : 'var(--theme-text-muted)',
                            }} />
                            <strong style={{ fontSize: 13 }}>{b.display_name || b.capability_key}</strong>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                              background: active
                                ? 'color-mix(in srgb,var(--theme-success) 12%,transparent)'
                                : 'color-mix(in srgb,var(--theme-warning) 12%,transparent)',
                              color: active ? 'var(--theme-success)' : 'var(--theme-warning)',
                              border: `1px solid ${active
                                ? 'color-mix(in srgb,var(--theme-success) 28%,var(--theme-border))'
                                : 'color-mix(in srgb,var(--theme-warning) 28%,var(--theme-border))'}`,
                            }}>
                              {b.status}
                            </span>
                          </div>
                          {b.description && (
                            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--theme-text-secondary)', lineHeight: 1.5 }}>
                              {b.description}
                            </p>
                          )}
                          <div style={{ fontSize: 11, color: 'var(--theme-text-muted)', marginTop: 4 }}>
                            Added {new Date(b.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          disabled={busy}
                          onClick={() => toggle(b)}
                          style={{
                            padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
                            background: active ? 'var(--theme-warning)' : 'var(--theme-success)',
                            color: 'var(--theme-text-inverse)',
                            opacity: busy ? 0.5 : 1,
                          }}
                        >
                          {busy ? '…' : active ? 'Suspend' : 'Activate'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => remove(b)}
                          style={{
                            padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            background: 'transparent', border: '1px solid color-mix(in srgb,var(--theme-danger) 35%,var(--theme-border))',
                            color: 'var(--theme-danger)', cursor: busy ? 'not-allowed' : 'pointer',
                            opacity: busy ? 0.5 : 1,
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {grouped.size === 0 && search && (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: 13 }}>
              No agents match "{search}"
            </div>
          )}
        </>
      )}
    </>
  );
}
