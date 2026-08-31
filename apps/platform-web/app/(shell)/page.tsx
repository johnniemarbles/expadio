import styles from "./page.module.css";
import { liveWorkspaceAdapter } from "../../lib/live-adapter";
import { WiringBanner, MetricCard, ActivityTimeline, DeniedState } from "@expadio/ui";
import { CapabilityTable } from "../../components/CapabilityTable/CapabilityTable";
import { ReviewQueue } from "../../components/ReviewQueue/ReviewQueue";
import Link from "next/link";
import { isDenied } from "@expadio/ui/contracts";
import { requestedOrganizationId, type RouteSearchParams } from "../../lib/request-context";

export default async function OverviewPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const overview = await liveWorkspaceAdapter.loadOverview(orgId);
  if (isDenied(overview)) return <DeniedState result={overview} />;
  const context = "?org=" + encodeURIComponent(orgId);
  return <>
    <section className={styles.pageHeading} aria-labelledby="page-title"><div><p className={styles.eyebrow}>Command center</p><h1 id="page-title">Overview</h1><p>What needs your attention, what is happening, and what EXPADIO has already completed for your business.</p></div></section>
    <WiringBanner source={overview.source} />
    <section className={styles.metricGrid} aria-label="Workspace metrics">{overview.metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>
    <div className={styles.dashboardGrid}>
      <section className={[styles.panel,styles.panelWide].join(" ")} aria-labelledby="capabilities-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Business settings</p><h2 id="capabilities-title">Recently changed</h2></div><Link href={"/capabilities"+context} className={styles.textButton}>View settings →</Link></div><CapabilityTable capabilities={overview.capabilities.slice(0,3)} query="" /></section>
      <section className={styles.panel} aria-labelledby="review-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Needs your attention</p><h2 id="review-title">Approvals and tasks</h2></div><span className={styles.countBadge}>{overview.reviews.length}</span></div><ReviewQueue reviews={overview.reviews} /></section>
    </div>
    <section className={[styles.panel,styles.activityPanel].join(" ")} aria-labelledby="activity-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>What the system completed</p><h2 id="activity-title">Recent activity</h2></div><Link href={"/audit"+context} className={styles.textButton}>Activity &amp; audit →</Link></div><ActivityTimeline items={overview.activity} /></section>
  </>;
}
