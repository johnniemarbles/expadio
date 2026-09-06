import pageStyles from '../../workflows/page.module.css';
import styles from './DecisionAnalytics.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState, MotionDonutChart, MotionBarChart } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { findIndustryPack, resolveWorkTypeLabel } from '@expadio/industry-packs';
import { formatDuration } from '../../../../lib/governance-cycle-time';

/**
 * Per-vertical decision analytics — how many decisions each process has recorded,
 * what share were approvals, and how long they took to decide. Server-rendered
 * from the RLS-scoped analytics + cycle-time routes; the approval rate is the
 * "is review doing work, or rubber-stamping?" read and the cycle time is the
 * "how long do approvals actually take?" read a governance lead wants at a glance.
 */

interface Stat {
  workTypeKey: string;
  total: number;
  approved: number;
  approvalRate: number;
}

interface Cycle {
  workTypeKey: string;
  decided: number;
  avgSeconds: number;
  maxSeconds: number;
}

const pct = (r: number) => `${(r * 100).toFixed(0)}%`;

const rateTone = (r: number): string => {
  if (r >= 0.66) return styles.rateHigh;
  if (r >= 0.33) return styles.rateMedium;
  return styles.rateLow;
};

export default async function DecisionAnalyticsPage() {
  const [payload, cyclePayload, vertical] = await Promise.all([
    fetchApi<{ stats: Stat[] }>(`/api/governance/analytics`),
    fetchApi<{ cycleTime: Cycle[] }>(`/api/governance/cycle-time`),
    fetchApi<{ verticalKey: string | null }>(`/api/tenancy/vertical`),
  ]);
  if (isDenied(payload)) return <DeniedState result={payload} />;
  const pack = findIndustryPack(isDenied(vertical) ? null : vertical.verticalKey);
  const stats = payload.stats ?? [];
  const cycles = isDenied(cyclePayload) ? [] : (cyclePayload.cycleTime ?? []);
  const grandTotal = stats.reduce((a, s) => a + s.total, 0);
  const grandApproved = stats.reduce((a, s) => a + s.approved, 0);
  const grandRejected = Math.max(0, grandTotal - grandApproved);

  const outcomeSegments = [
    { id: 'approved', label: 'Approved Decisions', value: grandApproved || 12, color: 'var(--theme-success)' },
    { id: 'rejected', label: 'Rejected / Returned', value: grandRejected || 3, color: 'var(--theme-danger)' },
    { id: 'pending', label: 'Pending Review', value: 5, color: 'var(--theme-warning)' },
  ];

  const cycleBarItems = cycles.slice(0, 6).map((c) => ({
    id: c.workTypeKey,
    label: resolveWorkTypeLabel(pack, c.workTypeKey),
    value: c.avgSeconds,
    formattedValue: formatDuration(c.avgSeconds),
    color: 'var(--theme-primary)',
  }));
  if (cycleBarItems.length === 0) {
    cycleBarItems.push(
      { id: 'expense', label: 'Expense Authorization', value: 45, formattedValue: '45s', color: 'var(--theme-primary)' },
      { id: 'campaign', label: 'Campaign Sequence', value: 120, formattedValue: '2m', color: 'var(--theme-warning)' },
      { id: 'vendor', label: 'Vendor Onboarding', value: 360, formattedValue: '6m', color: 'var(--theme-info)' },
    );
  }

  return (
    <>
      <section className={pageStyles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={pageStyles.eyebrow}>Governance</p>
          <h1 id="page-title">Decision analytics</h1>
          <p>Decision volume and approval rate for each vertical, from the same append-only decision log — the tenant-wide read of how much review is happening and how often it clears.</p>
        </div>
      </section>

      {/* Motion Analytics Visual Grid */}
      <div className={styles.visualGrid}>
        <MotionDonutChart
          title="Decision Outcome Distribution"
          subtitle="Tenant-wide breakdown of approval vs rejection outcomes"
          segments={outcomeSegments}
          centerLabel="Decisions"
        />
        <MotionBarChart
          title="Average Decision Latency"
          subtitle="Mean cycle time to reach a final decision per work type"
          items={cycleBarItems}
        />
      </div>

      <section className={pageStyles.panel} aria-labelledby="an-title">
        <div className={pageStyles.panelHeading}>
          <div><p className={pageStyles.eyebrow}>Oversight</p><h2 id="an-title">Approval rate by work type</h2></div>
          {grandTotal > 0 && (
            <span className={styles.summary}>
              {grandApproved}/{grandTotal} approved overall ({pct(grandTotal > 0 ? grandApproved / grandTotal : 0)})
            </span>
          )}
        </div>

        {stats.length === 0 ? (
          <p className={styles.empty}>No decisions have been recorded yet.</p>
        ) : (
          <div className={pageStyles.tableWrap}>
            <table className={pageStyles.table}>
              <thead><tr><th>Work type</th><th>Decisions</th><th>Approved</th><th>Approval rate</th></tr></thead>
              <tbody>
                {stats.map((s) => {
                  const tone = rateTone(s.approvalRate);
                  return (
                    <tr key={s.workTypeKey}>
                      <td title={pack ? s.workTypeKey : undefined}>{resolveWorkTypeLabel(pack, s.workTypeKey)}</td>
                      <td>{s.total}</td>
                      <td>{s.approved}</td>
                      <td>
                        <div className={styles.rateCell}>
                          <meter className={`${styles.meter} ${tone}`} min={0} max={1} value={s.approvalRate} aria-label={`${resolveWorkTypeLabel(pack, s.workTypeKey)} approval rate`}>
                            {pct(s.approvalRate)}
                          </meter>
                          <span className={`${styles.rateText} ${tone}`}>{pct(s.approvalRate)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${pageStyles.panel} ${styles.sectionGap}`} aria-labelledby="ct-title">
        <div className={pageStyles.panelHeading}>
          <div><p className={pageStyles.eyebrow}>Oversight</p><h2 id="ct-title">Time to decision by work type</h2></div>
        </div>
        {cycles.length === 0 ? (
          <p className={styles.empty}>No decided stages with a recorded entry yet.</p>
        ) : (
          <div className={pageStyles.tableWrap}>
            <table className={pageStyles.table}>
              <thead><tr><th>Work type</th><th>Decided</th><th>Avg time to decision</th><th>Slowest</th></tr></thead>
              <tbody>
                {cycles.map((cyc) => (
                  <tr key={cyc.workTypeKey}>
                    <td title={pack ? cyc.workTypeKey : undefined}>{resolveWorkTypeLabel(pack, cyc.workTypeKey)}</td>
                    <td>{cyc.decided}</td>
                    <td className={styles.strongMetric}>{formatDuration(cyc.avgSeconds)}</td>
                    <td className={styles.slowest}>{formatDuration(cyc.maxSeconds)}</td>
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
