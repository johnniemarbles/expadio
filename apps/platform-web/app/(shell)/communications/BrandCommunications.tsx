import type { CommunicationOverview } from '../../../lib/communication-contracts';
import styles from './page.module.css';

/** Brand view intentionally receives no connector or credential metadata.
 * Brand configuration controls will be enabled as their governed APIs land. */
export function BrandCommunications({ overview }: { overview: CommunicationOverview }) {
  return (
    <div className={styles.dashboardContainer}>
      <div className={styles.topNavRow}>
        <div>
          <div className={styles.breadcrumbs}>Brand workspace / Communications</div>
          <h1 className={styles.commandCenterTitle}>Brand communications</h1>
          <p>The platform integrates and operates providers. Your brand uses those services with its own senders, templates and preferences.</p>
        </div>
      </div>
      <section className={styles.cardPanel}>
        <h2>Configuration readiness</h2>
        <p>{overview.readiness.verifiedSenders} verified senders · {overview.readiness.pendingSenders} pending senders · {overview.readiness.activeTemplates} active templates</p>
        <p>Self-service channel and sender configuration is not yet available in this view. Ask your platform administrator to complete onboarding. No provider API keys are required from your brand.</p>
      </section>
      <section className={styles.cardPanel}>
        <h2>Delivery activity</h2>
        <p>{overview.totals.deliveries} deliveries · {overview.totals.delivered} delivered · {overview.totals.inFlight} in flight · {overview.totals.failed} failed</p>
        <table className={styles.table}>
          <thead><tr><th>Channel</th><th>Total</th><th>Delivered</th><th>Failed</th></tr></thead>
          <tbody>{overview.channels.map(channel => (
            <tr key={channel.channel}><td>{channel.channel}</td><td>{channel.total}</td><td>{channel.delivered}</td><td>{channel.failed}</td></tr>
          ))}</tbody>
        </table>
        <p>Delivery activity is not a channel entitlement or a provider-readiness guarantee.</p>
      </section>
    </div>
  );
}
