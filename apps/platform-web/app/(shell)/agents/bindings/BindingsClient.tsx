'use client';

import React, { useState } from 'react';
import styles from '../page.module.css';

interface Binding {
  binding_id: string;
  capability_key: string;
  status: string;
  mapped_to_resource: string;
  created_at: string;
}

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

  const refresh = async () => {
    const res = await fetch('/api/agents/bindings');
    if (res.ok) setBindings(await res.json());
  };

  const toggle = async (b: Binding) => {
    setWorking(b.binding_id);
    const action = b.status.toUpperCase() === 'ACTIVE' || b.status.toUpperCase() === 'BOUND'
      ? 'suspend' : 'activate';
    const res = await fetch('/api/agents/bindings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ binding_id: b.binding_id, action }),
    });
    if (res.ok) {
      setNotice({ msg: `Binding ${action}d.`, kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to update binding.', kind: 'err' });
    }
    setWorking(null);
  };

  const remove = async (b: Binding) => {
    if (!confirm(`Remove binding for "${b.capability_key}"?`)) return;
    setWorking(b.binding_id);
    const res = await fetch(`/api/agents/bindings?id=${encodeURIComponent(b.binding_id)}`, { method: 'DELETE' });
    if (res.ok) {
      setNotice({ msg: 'Binding removed.', kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to remove binding.', kind: 'err' });
    }
    setWorking(null);
  };

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
              border: '1px solid var(--theme-border)', background: 'var(--theme-surface)',
              color: 'var(--theme-text-primary)', outline: 'none',
            }}
          />
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
    </>
  );
}
