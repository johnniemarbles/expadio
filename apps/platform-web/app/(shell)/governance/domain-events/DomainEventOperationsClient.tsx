'use client';

import { useMemo, useState } from 'react';
import type { DomainEventOperationItem } from './page';

type StatusFilter = 'ALL' | DomainEventOperationItem['status'];

interface Payload {
  items: DomainEventOperationItem[];
  counts: {
    total: number;
    dead: number;
    failed: number;
    claimed: number;
    pending: number;
    published: number;
  };
}

const FILTERS: readonly StatusFilter[] = [
  'ALL',
  'DEAD',
  'FAILED',
  'CLAIMED',
  'PENDING',
  'PUBLISHED',
];

function fmt(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export function DomainEventOperationsClient({ initial }: { initial: Payload }) {
  const [payload, setPayload] = useState(initial);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(
    () => filter === 'ALL'
      ? payload.items
      : payload.items.filter((item) => item.status === filter),
    [filter, payload.items],
  );

  async function reload() {
    const response = await fetch('/api/governance/domain-events?limit=200', {
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? data.message ?? 'Unable to reload Domain Event operations.');
    setPayload(data);
  }

  async function requeue(item: DomainEventOperationItem) {
    const reason = prompt(
      'Why should this terminal Domain Event be requeued? This reason is written to the immutable audit record.',
    )?.trim();
    if (!reason) return;
    if (!confirm(`Requeue ${item.eventType}? This starts a new delivery retry cycle.`)) return;

    setBusy(item.outboxId);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/governance/domain-events/${encodeURIComponent(item.outboxId)}/requeue`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-expadio-reauth-at': new Date().toISOString(),
          },
          body: JSON.stringify({ reason }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? data.message ?? 'Requeue failed.');
      }
      setNotice(`${item.eventType} was requeued. Correlation: ${data.correlationId}`);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Requeue failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main style={{ display: 'grid', gap: 18 }}>
      <section>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6366f1' }}>
          Governance · event operations
        </p>
        <h1 style={{ margin: '5px 0 6px' }}>Domain Event delivery</h1>
        <p style={{ margin: 0, color: '#64748b', maxWidth: 850 }}>
          Inspect tenant-scoped event delivery, retries and terminal dead letters. Domain Events are immutable; requeue only starts a new outbox delivery cycle and records who authorized it.
        </p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        <Stat label="Dead" value={payload.counts.dead} danger={payload.counts.dead > 0} />
        <Stat label="Failed" value={payload.counts.failed} danger={payload.counts.failed > 0} />
        <Stat label="Claimed" value={payload.counts.claimed} />
        <Stat label="Pending" value={payload.counts.pending} />
        <Stat label="Published" value={payload.counts.published} />
      </section>

      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Domain Event status filters">
        {FILTERS.map((status) => (
          <button
            type="button"
            key={status}
            onClick={() => setFilter(status)}
            style={{
              border: '1px solid #cbd5e1',
              borderRadius: 999,
              padding: '6px 11px',
              background: filter === status ? '#eef2ff' : '#fff',
              color: filter === status ? '#3730a3' : '#475569',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {status}
          </button>
        ))}
      </nav>

      {error ? <div role="alert" style={{ padding: 10, borderRadius: 8, background: '#fef2f2', color: '#991b1b' }}>{error}</div> : null}
      {notice ? <div style={{ padding: 10, borderRadius: 8, background: '#f0fdf4', color: '#166534' }}>{notice}</div> : null}

      <section style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <thead>
            <tr style={{ textAlign: 'left', background: '#f8fafc' }}>
              {['Status', 'Event', 'Aggregate', 'Attempts', 'Available', 'Last error', 'Action'].map((label) => (
                <th key={label} style={{ padding: '10px 12px', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.outboxId} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: 12 }}><StatusBadge status={item.status} /></td>
                <td style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700 }}>{item.eventType}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{item.eventId}</div>
                </td>
                <td style={{ padding: 12 }}>
                  <div>{item.aggregateType}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{item.aggregateId}</div>
                </td>
                <td style={{ padding: 12, fontWeight: 700 }}>{item.attempts}</td>
                <td style={{ padding: 12, fontSize: 12 }}>{fmt(item.availableAt)}</td>
                <td style={{ padding: 12, maxWidth: 320, color: item.lastError ? '#991b1b' : '#94a3b8', fontSize: 12 }}>
                  {item.lastError ?? '—'}
                </td>
                <td style={{ padding: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <a
                      href={`/governance/execution-traces/${encodeURIComponent(item.eventId)}`}
                      style={{ color: '#4f46e5', fontWeight: 800, fontSize: 12 }}
                    >
                      Trace
                    </a>
                  {item.status === 'DEAD' ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void requeue(item)}
                      style={{ border: 0, borderRadius: 8, padding: '7px 10px', background: '#7c3aed', color: '#fff', fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}
                    >
                      {busy === item.outboxId ? 'Requeueing…' : 'Requeue'}
                    </button>
                  ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No Domain Event outbox items match this filter.</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#fff' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 850, color: danger ? '#b91c1c' : '#0f172a' }}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: DomainEventOperationItem['status'] }) {
  const tones: Record<DomainEventOperationItem['status'], { bg: string; fg: string }> = {
    DEAD: { bg: '#fee2e2', fg: '#991b1b' },
    FAILED: { bg: '#fef3c7', fg: '#92400e' },
    CLAIMED: { bg: '#dbeafe', fg: '#1d4ed8' },
    PENDING: { bg: '#f1f5f9', fg: '#475569' },
    PUBLISHED: { bg: '#dcfce7', fg: '#166534' },
  };
  const tone = tones[status];
  return <span style={{ padding: '3px 8px', borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 800 }}>{status}</span>;
}
