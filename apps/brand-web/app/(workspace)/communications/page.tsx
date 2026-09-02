import { loadBrandCommunicationOverview } from '../../../lib/brand-communications';
import { resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

function metric(label: string, value: number | string, hint: string) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

export default async function BrandCommunicationsPage() {
  const context = await resolveBrandContext();
  const overview = await withBrandTransaction(context, (client) => loadBrandCommunicationOverview(client, {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
  }));
  const deliveryRate = overview.totals.deliveries === 0
    ? '—'
    : `${Math.round((overview.totals.delivered / overview.totals.deliveries) * 1000) / 10}%`;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Brand workspace / Communications</p>
        <h1>Communications</h1>
        <p>Business-facing delivery health and messaging readiness for {context.organizationName}. Delivery infrastructure and platform suppression governance remain Platform-owned.</p>
      </div>
      <span className={styles.live}>Live snapshot · {new Date(overview.capturedAt).toLocaleString()}</span>
    </header>

    <section className={styles.metrics} aria-label="Communication summary">
      {metric('Deliveries', overview.totals.deliveries, 'Organization-scoped')}
      {metric('Delivered', overview.totals.delivered, deliveryRate === '—' ? 'No traffic yet' : `${deliveryRate} delivery rate`)}
      {metric('In flight', overview.totals.inFlight, 'Awaiting terminal state')}
      {metric('Failed', overview.totals.failed, 'Failed, bounced, complained or cancelled')}
    </section>

    <section className={styles.grid}>
      <article className={styles.card}>
        <div className={styles.cardHeader}><div><p className={styles.eyebrow}>Readiness</p><h2>Brand messaging readiness</h2></div></div>
        <dl className={styles.readiness}>
          <div><dt>Active templates</dt><dd>{overview.readiness.activeTemplates}</dd></div>
          <div><dt>Draft templates</dt><dd>{overview.readiness.draftTemplates}</dd></div>
          <div><dt>Verified senders</dt><dd>{overview.readiness.verifiedSenders}</dd></div>
          <div><dt>Pending senders</dt><dd>{overview.readiness.pendingSenders}</dd></div>
          <div><dt>Active suppressions</dt><dd>{overview.readiness.activeSuppressions}</dd></div>
        </dl>
        <p className={styles.note}>Counts include Platform or tenant defaults where they are eligible for this organization; infrastructure configuration is not exposed here.</p>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}><div><p className={styles.eyebrow}>Channels</p><h2>Delivery performance</h2></div></div>
        {overview.channels.length === 0 ? <p className={styles.empty}>No organization delivery traffic has been recorded yet.</p> : <div className={styles.tableWrap}><table>
          <thead><tr><th>Channel</th><th>Total</th><th>Delivered</th><th>Failed</th><th>Rate</th></tr></thead>
          <tbody>{overview.channels.map((channel) => <tr key={channel.channel}>
            <td>{channel.channel}</td><td>{channel.total}</td><td>{channel.delivered}</td><td>{channel.failed}</td><td>{channel.deliveryRatePct === null ? '—' : `${channel.deliveryRatePct}%`}</td>
          </tr>)}</tbody>
        </table></div>}
      </article>
    </section>

    <section className={styles.card}>
      <div className={styles.cardHeader}><div><p className={styles.eyebrow}>Lifecycle</p><h2>Recent deliveries</h2></div></div>
      {overview.recentDeliveries.length === 0 ? <p className={styles.empty}>Recent governed deliveries will appear here once this organization sends messages.</p> : <div className={styles.tableWrap}><table>
        <thead><tr><th>Delivery</th><th>Channel</th><th>State</th><th>Attempts</th><th>Reason</th><th>Requested</th></tr></thead>
        <tbody>{overview.recentDeliveries.map((delivery) => <tr key={delivery.deliveryId}>
          <td className={styles.mono}>{delivery.deliveryId}</td><td>{delivery.channel}</td><td>{delivery.state}</td><td>{delivery.attemptCount}</td><td>{delivery.reasonCode ?? '—'}</td><td>{new Date(delivery.requestedAt).toLocaleString()}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}
