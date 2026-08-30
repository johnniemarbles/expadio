import styles from "../communications/page.module.css";
import { PlatformHealthDashboard } from "./PlatformHealthDashboard";

export default async function PlatformHealthPage({
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
          <div className={styles.breadcrumbs}>Platform administration / Health</div>
          <h1 className={styles.commandCenterTitle}>Platform health dashboard</h1>
        </div>
        <div className={styles.healthyBadge}>
          <span className={styles.healthyDot} /> Read-only operations
        </div>
      </div>

      <div className={styles.fleetHeaderRow}>
        <div className={styles.fleetTitle}>
          <h2>Unified operational posture</h2>
          <p>Review execution, communications, scheduler and transactional outbox health without invoking recovery commands or worker mutations.</p>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 10px", borderRadius: 999, background: "#eef2ff", color: "#3730a3" }}>
          Uses governed health APIs
        </span>
      </div>

      <PlatformHealthDashboard queryString={q} />
    </div>
  );
}
