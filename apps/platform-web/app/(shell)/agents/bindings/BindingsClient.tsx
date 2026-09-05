'use client';

<<<<<<< HEAD
import React, { useState, useMemo } from 'react';
=======
import React, { useState } from 'react';
>>>>>>> origin/main
import styles from '../page.module.css';

interface Binding {
  binding_id: string;
  capability_key: string;
<<<<<<< HEAD
  display_name: string;
  department: string;
  description: string;
=======
>>>>>>> origin/main
  status: string;
  mapped_to_resource: string;
  created_at: string;
}

<<<<<<< HEAD
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

=======
function statusClass(status: string, s: typeof styles): string {
  const n = status.toUpperCase();
  if (n === 'BOUND' || n === 'ACTIVE') return [s.statusBadge, s.statusSuccess].join(' ');
  if (n === 'SUSPENDED' || n === 'FAILED' || n === 'ERROR') return [s.statusBadge, s.statusDanger].join(' ');
  if (n === 'BINDING' || n === 'PENDING' || n === 'PROCESSING') return [s.statusBadge, s.statusLive].join(' ');
  return [s.statusBadge, s.statusNeutral].join(' ');
}

const btnBase: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none',
  cursor: 'pointer', marginRight: 6,
};

export function BindingsClient({ initial }: { initial: Binding[] }) {
  const [bindings, setBindings] = useState<Binding[]>(initial);
  const [working, setWorking] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

>>>>>>> origin/main
  const refresh = async () => {
    const res = await fetch('/api/agents/bindings');
    if (res.ok) setBindings(await res.json());
  };

  const toggle = async (b: Binding) => {
    setWorking(b.binding_id);
<<<<<<< HEAD
    const action = isActive(b.status) ? 'suspend' : 'activate';
=======
    const action = b.status.toUpperCase() === 'ACTIVE' || b.status.toUpperCase() === 'BOUND'
      ? 'suspend' : 'activate';
>>>>>>> origin/main
    const res = await fetch('/api/agents/bindings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ binding_id: b.binding_id, action }),
    });
    if (res.ok) {
<<<<<<< HEAD
      setNotice({ msg: `Agent ${action}d.`, kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to update status.', kind: 'err' });
=======
      setNotice({ msg: `Binding ${action}d.`, kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to update binding.', kind: 'err' });
>>>>>>> origin/main
    }
    setWorking(null);
  };

  const remove = async (b: Binding) => {
<<<<<<< HEAD
    if (!confirm(`Remove "${b.display_name || b.capability_key}" from this tenant?`)) return;
    setWorking(b.binding_id);
    const res = await fetch(`/api/agents/bindings?id=${encodeURIComponent(b.binding_id)}`, { method: 'DELETE' });
    if (res.ok) {
      setNotice({ msg: 'Agent removed.', kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to remove.', kind: 'err' });
=======
    if (!confirm(`Remove binding for "${b.capability_key}"?`)) return;
    setWorking(b.binding_id);
    const res = await fetch(`/api/agents/bindings?id=${encodeURIComponent(b.binding_id)}`, { method: 'DELETE' });
    if (res.ok) {
      setNotice({ msg: 'Binding removed.', kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to remove binding.', kind: 'err' });
>>>>>>> origin/main
    }
    setWorking(null);
  };

<<<<<<< HEAD
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
=======
  const addBinding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    setAdding(true);
    const res = await fetch('/api/agents/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability_key: newKey.trim() }),
    });
    if (res.ok) {
      setNewKey('');
      setNotice({ msg: 'Binding created.', kind: 'ok' });
      await refresh();
    } else {
      const j = await res.json();
      setNotice({ msg: j.error ?? 'Failed to create binding.', kind: 'err' });
    }
    setAdding(false);
  };

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Agent Intelligence</p>
          <h1 id="page-title">Agent Bindings</h1>
          <p>Map published capabilities to governed agent identities. Activate or suspend individual bindings.</p>
        </div>
      </section>

      <section className={styles.panel} style={{ marginBottom: 16 }}>
        <div className={styles.panelHeading}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Bind a Capability</h2>
        </div>
        <form onSubmit={addBinding} style={{ display: 'flex', gap: 10, padding: '14px 19px', alignItems: 'center' }}>
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="e.g. cbos.context.observe"
            disabled={adding}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 7, fontSize: 13,
>>>>>>> origin/main
              border: '1px solid var(--theme-border)', background: 'var(--theme-surface)',
              color: 'var(--theme-text-primary)', outline: 'none',
            }}
          />
<<<<<<< HEAD
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
=======
          <button
            type="submit"
            disabled={adding || !newKey.trim()}
            style={{ ...btnBase, background: 'var(--theme-primary)', color: 'var(--theme-text-inverse)', opacity: adding || !newKey.trim() ? 0.5 : 1 }}
          >
            {adding ? 'Adding…' : 'Add Binding'}
          </button>
        </form>
      </section>

      {notice && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12,
          background: notice.kind === 'err' ? 'color-mix(in srgb,var(--theme-danger) 8%,var(--theme-surface))' : 'color-mix(in srgb,var(--theme-success) 8%,var(--theme-surface))',
          border: `1px solid ${notice.kind === 'err' ? 'var(--theme-danger)' : 'var(--theme-success)'}`,
          color: notice.kind === 'err' ? 'var(--theme-danger)' : 'var(--theme-success)',
        }}>
          {notice.msg}
        </div>
      )}

      <section className={styles.panel} aria-labelledby="bindings-title">
        <div className={styles.panelHeading}>
          <h2 id="bindings-title" style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Active Capability Bindings ({bindings.length})
          </h2>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Capability Key</th>
                <th>Status</th>
                <th>Mapped Resource</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => {
                const isActive = b.status.toUpperCase() === 'ACTIVE' || b.status.toUpperCase() === 'BOUND';
                const busy = working === b.binding_id;
                return (
                  <tr key={b.binding_id}>
                    <td><strong>{b.capability_key}</strong></td>
                    <td><span className={statusClass(b.status, styles)}>{b.status}</span></td>
                    <td>{b.mapped_to_resource || 'System'}</td>
                    <td className={styles.muted}>{new Date(b.created_at).toLocaleString()}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        disabled={busy}
                        onClick={() => toggle(b)}
                        style={{
                          ...btnBase,
                          background: isActive ? 'color-mix(in srgb,var(--theme-warning) 12%,var(--theme-surface))' : 'color-mix(in srgb,var(--theme-success) 12%,var(--theme-surface))',
                          color: isActive ? 'var(--theme-warning)' : 'var(--theme-success)',
                          border: `1px solid ${isActive ? 'color-mix(in srgb,var(--theme-warning) 30%,var(--theme-border))' : 'color-mix(in srgb,var(--theme-success) 30%,var(--theme-border))'}`,
                          opacity: busy ? 0.5 : 1,
                        }}
                      >
                        {busy ? '…' : isActive ? 'Suspend' : 'Activate'}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => remove(b)}
                        style={{
                          ...btnBase, marginRight: 0,
                          background: 'transparent',
                          color: 'var(--theme-danger)',
                          border: '1px solid color-mix(in srgb,var(--theme-danger) 30%,var(--theme-border))',
                          opacity: busy ? 0.5 : 1,
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
          {bindings.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--theme-text-secondary)', fontSize: 13 }}>
              No capability bindings yet. Add one above.
            </div>
          )}
        </div>
      </section>
>>>>>>> origin/main
    </>
  );
}
