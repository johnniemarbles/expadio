'use client';

import React, { useState, useMemo } from 'react';
import styles from '../page.module.css';

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
  return s === 'ACTIVE';
}

export function BindingsClient({ initial }: { initial: Binding[] }) {
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
              (b.department || '').toLowerCase().includes(q))
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
    const res = await fetch('/api/agents/bindings');
    if (res.ok) setBindings(await res.json());
  };

  const toggle = async (b: Binding) => {
    setWorking(b.binding_id);
    const action = isActive(b.status) ? 'suspend' : 'activate';
    const res = await fetch('/api/agents/bindings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ binding_id: b.binding_id, action }),
    });
    if (res.ok) {
      setNotice({ msg: `Agent ${action}d.`, kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to update status.', kind: 'err' });
    }
    setWorking(null);
  };

  const remove = async (b: Binding) => {
    if (!confirm(`Remove "${b.display_name || b.capability_key}" from this tenant?`)) return;
    setWorking(b.binding_id);
    const res = await fetch(`/api/agents/bindings?id=${encodeURIComponent(b.binding_id)}`, { method: 'DELETE' });
    if (res.ok) {
      setNotice({ msg: 'Agent removed.', kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to remove.', kind: 'err' });
    }
    setWorking(null);
  };

  const activeCount = bindings.filter((b) => isActive(b.status)).length;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="bindings-title">
        <div>
          <p className={styles.eyebrow}>Agent Intelligence</p>
          <h1 id="bindings-title">Active Bindings</h1>
          <p>
            {bindings.length} agent{bindings.length !== 1 ? 's' : ''} bound to this tenant
            · {activeCount} active. Use the Catalog to add agents.
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

      {/* Search + department filter */}
      {bindings.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bound agents…"
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
              >All</button>
              {departments.map((dept) => (
                <button key={dept} onClick={() => setActiveDept(activeDept === dept ? null : dept)}
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
      )}

      {/* Department-grouped list */}
      {Array.from(grouped.entries()).map(([dept, items]) => (
        <section key={dept} className={styles.panel} style={{ marginBottom: 16 }} aria-labelledby={`dept-${dept}`}>
          <div className={styles.panelHeading}>
            <h2 id={`dept-${dept}`} style={{ margin: 0, fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em' }}>
              {dept}
            </h2>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
              background: 'var(--theme-surface-muted)', color: 'var(--theme-text-muted)',
            }}>
              {items.length} agent{items.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th>Bound</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => {
                  const active = isActive(b.status);
                  const busy = working === b.binding_id;
                  return (
                    <tr key={b.binding_id}>
                      <td>
                        <strong style={{ fontSize: 13 }}>{b.display_name || b.capability_key}</strong>
                        <div style={{ fontSize: 11, color: 'var(--theme-text-muted)', fontFamily: 'var(--theme-font-mono)', marginTop: 2 }}>
                          {b.capability_key}
                        </div>
                        {b.description && (
                          <div style={{ fontSize: 11, color: 'var(--theme-text-secondary)', marginTop: 3 }}>{b.description}</div>
                        )}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                            background: active ? 'var(--theme-success)' : 'var(--theme-text-muted)',
                          }} />
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                            background: active
                              ? 'color-mix(in srgb,var(--theme-success) 12%,transparent)'
                              : 'color-mix(in srgb,var(--theme-warning) 12%,transparent)',
                            color: active ? 'var(--theme-success)' : 'var(--theme-warning)',
                          }}>
                            {b.status}
                          </span>
                        </span>
                      </td>
                      <td className={styles.muted}>{b.mapped_to_resource || '—'}</td>
                      <td className={styles.muted}>{new Date(b.created_at).toLocaleDateString()}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          disabled={busy}
                          onClick={() => toggle(b)}
                          style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            border: `1px solid ${active
                              ? 'color-mix(in srgb,var(--theme-warning) 40%,var(--theme-border))'
                              : 'color-mix(in srgb,var(--theme-success) 40%,var(--theme-border))'}`,
                            background: 'transparent',
                            color: active ? 'var(--theme-warning)' : 'var(--theme-success)',
                            cursor: busy ? 'not-allowed' : 'pointer',
                            marginRight: 6, opacity: busy ? 0.5 : 1,
                          }}
                        >
                          {busy ? '…' : active ? 'Suspend' : 'Activate'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => remove(b)}
                          style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            border: '1px solid color-mix(in srgb,var(--theme-danger) 30%,var(--theme-border))',
                            background: 'transparent', color: 'var(--theme-danger)',
                            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {bindings.length === 0 && (
        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: 13 }}>
          No agents bound yet. Go to <strong>Catalog</strong> to activate agents for this tenant.
        </div>
      )}
    </>
  );
}
