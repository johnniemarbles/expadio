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
    <section className={styles.pageHeading} aria-labelledby="page-title"><div><p className={styles.eyebrow}>Command center</p><h1 id="page-title">Overview</h1><p>A governed view of your organizations, capabilities, and company knowledge.</p></div></section>
    <WiringBanner source={overview.source} />
    <section className={styles.metricGrid} aria-label="Workspace metrics">{overview.metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>
    <div className={styles.dashboardGrid}>
      <section className={[styles.panel,styles.panelWide].join(" ")} aria-labelledby="capabilities-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Capability fabric</p><h2 id="capabilities-title">Recently changed</h2></div><Link href={"/capabilities"+context} className={styles.textButton}>View all →</Link></div><CapabilityTable capabilities={overview.capabilities.slice(0,3)} query="" /></section>
      <section className={styles.panel} aria-labelledby="review-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Human review</p><h2 id="review-title">Decision queue</h2></div><span className={styles.countBadge}>{overview.reviews.length}</span></div><ReviewQueue reviews={overview.reviews} /></section>
    </div>
    <section className={[styles.panel,styles.activityPanel].join(" ")} aria-labelledby="activity-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Traceability</p><h2 id="activity-title">Latest governed activity</h2></div><Link href={"/audit"+context} className={styles.textButton}>Open audit →</Link></div><ActivityTimeline items={overview.activity} /></section>
  </>;
}

