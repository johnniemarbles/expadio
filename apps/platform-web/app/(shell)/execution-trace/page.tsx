import { BusinessExecutionTracePanel } from "../communications/BusinessExecutionTracePanel";
import styles from "../communications/page.module.css";

export default async function ExecutionTracePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === "string") qs.set("account", params.account);
  if (typeof params.org === "string") qs.set("org", params.org);
  const q = qs.toString() ? `?${qs.toString()}` : "";

  return (
    <div className={styles.dashboardContainer}>
      <div className={styles.topNavRow}>
        <div>
          <div className={styles.breadcrumbs}>Platform administration / Execution</div>
          <h1 className={styles.commandCenterTitle}>Business execution trace</h1>
        </div>
        <div className={styles.healthyBadge}>
          <span className={styles.healthyDot} /> Read-only observability
        </div>
      </div>

      <div className={styles.fleetHeaderRow}>
        <div className={styles.fleetTitle}>
          <h2>Trace one business event through the execution spine</h2>
          <p>Load a bounded event, correlation or aggregate trace across domain events, outbox, governed actions, schedules, communications, provider attempts, webhooks and operational tasks.</p>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 10px", borderRadius: 999, background: "#eef2ff", color: "#3730a3" }}>
          Uses GET /api/execution/trace
        </span>
      </div>

      <BusinessExecutionTracePanel queryString={q} />
    </div>
  );
}
