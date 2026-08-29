import React from 'react';
import styles from '../../workflows/page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';

/**
 * Per-vertical decision analytics — how many decisions each process has recorded
 * and what share were approvals. Server-rendered from the RLS-scoped analytics
 * route; the approval rate is the "is review doing work, or rubber-stamping?"
 * read a governance lead wants at a glance.
 */

interface Stat {
  workTypeKey: string;
  total: number;
  approved: number;
  approvalRate: number;
}

const pct = (r: number) => `${(r * 100).toFixed(0)}%`;

// A calmer bar for high approval rates, warmer as rejections dominate.
const barColor = (r: number) => (r >= 0.66 ? '#0f766e' : r >= 0.33 ? '#b45309' : '#b91c1c');

export default async function DecisionAnalyticsPage() {
  const payload = await fetchApi<{ stats: Stat[] }>(`/api/governance/analytics`);
  if (isDenied(payload)) return <DeniedState result={payload} />;
  const stats = payload.stats ?? [];
  const grandTotal = stats.reduce((a, s) => a + s.total, 0);
  const grandApproved = stats.reduce((a, s) => a + s.approved, 0);

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Governance</p>
          <h1 id="page-title">Decision analytics</h1>
          <p>Decision volume and approval rate for each vertical, from the same append-only decision log — the tenant-wide read of how much review is happening and how often it clears.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="an-title">
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>Oversight</p><h2 id="an-title">Approval rate by work type</h2></div>
          {grandTotal > 0 && (
            <span style={{ fontSize: 13, color: '#475569' }}>
              {grandApproved}/{grandTotal} approved overall ({pct(grandTotal > 0 ? grandApproved / grandTotal : 0)})
            </span>
          )}
        </div>

        {stats.length === 0 ? (
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>No decisions have been recorded yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Work type</th><th>Decisions</th><th>Approved</th><th>Approval rate</th></tr></thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.workTypeKey}>
                    <td>{s.workTypeKey}</td>
                    <td>{s.total}</td>
                    <td>{s.approved}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
                        <div aria-hidden style={{ flex: 1, height: 8, background: 'var(--surface-2, #f1f5f9)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: pct(s.approvalRate), height: '100%', background: barColor(s.approvalRate) }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: barColor(s.approvalRate), width: 40, textAlign: 'right' }}>{pct(s.approvalRate)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
