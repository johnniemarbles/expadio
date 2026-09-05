'use client';

import React, { useState } from 'react';
import styles from '../../workspace.module.css';

interface Binding {
  binding_id: string;
  capability_key: string;
  status: string;
  mapped_to_resource: string;
  created_at: string;
}

function isActive(status: string) {
  const s = status.toUpperCase();
  return s === 'ACTIVE' || s === 'BOUND';
}

const card: React.CSSProperties = {
  background: 'var(--theme-surface)',
  border: '1px solid var(--theme-border)',
  borderRadius: 12,
  overflow: 'hidden',
  marginBottom: 12,
};

const cardRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 16, padding: '14px 20px', borderBottom: '1px solid var(--theme-border)',
};

export function AgentsClient({ initial }: { initial: Binding[] }) {
  const [bindings, setBindings] = useState<Binding[]>(initial);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

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
      setNotice({ msg: `Agent ${action}d.`, kind: 'ok' });
      await refresh();
    } else {
      setNotice({ msg: 'Failed to update agent status.', kind: 'err' });
    }
    setWorking(null);
  };

  const remove = async (b: Binding) => {
    if (!confirm(`Remove agent capability "${b.capability_key}"? This cannot be undone.`)) return;
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

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Workspace Settings</p>
          <h1>AI Agent Management</h1>
          <p>Activate or suspend AI agent capabilities available to this workspace.</p>
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
        </div>
      )}

      {bindings.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--theme-text-secondary)', fontSize: 14 }}>
          No AI agent capabilities are bound to this workspace yet. Contact your platform administrator to configure agent access.
        </div>
      )}

      <div style={card}>
        {bindings.length > 0 && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--theme-border)', background: 'var(--theme-canvas)' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--theme-text-secondary)', textTransform: 'uppercase' }}>
              {bindings.length} Agent{bindings.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
        {bindings.map((b, i) => {
          const active = isActive(b.status);
          const busy = working === b.binding_id;
          return (
            <div key={b.binding_id} style={{ ...cardRow, borderBottom: i === bindings.length - 1 ? 'none' : '1px solid var(--theme-border)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: active ? 'var(--theme-success)' : 'var(--theme-text-secondary)',
                  }} />
                  <strong style={{ fontSize: 14 }}>{b.capability_key}</strong>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
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
                <div style={{ fontSize: 12, color: 'var(--theme-text-secondary)', marginTop: 2 }}>
                  {b.mapped_to_resource ? `Mode: ${b.mapped_to_resource}` : 'System agent'}
                  {' · '}Added {new Date(b.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  disabled={busy}
                  onClick={() => toggle(b)}
                  style={{
                    padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, border: 'none',
                    cursor: busy ? 'not-allowed' : 'pointer',
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
                    padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                    background: 'transparent', border: '1px solid var(--theme-danger)',
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
    </>
  );
}
