import styles from "../page.module.css";
import { liveWorkspaceAdapter } from "../../../lib/live-adapter";
import { WiringBanner, MetricCard, ActivityTimeline, DeniedState, MotionAreaChart, MotionDonutChart } from "@expadio/ui";
import { CapabilityTable } from "../../../components/CapabilityTable/CapabilityTable";
import { ReviewQueue } from "../../../components/ReviewQueue/ReviewQueue";
import Link from "next/link";
import { isDenied } from "@expadio/ui/contracts";
import { requestedOrganizationId, type RouteSearchParams } from "../../../lib/request-context";

export default async function BusinessOverviewPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const overview = await liveWorkspaceAdapter.loadOverview(orgId);
  if (isDenied(overview)) return <DeniedState result={overview} />;
  const context = "?org=" + encodeURIComponent(orgId);

  const categories = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', 'Now'];
  const series = [
    { id: 'events', label: 'Governed Events', color: '#facc15', data: [120, 180, 240, 420, 310, 480, Math.max(overview.activity.length * 15, 520)] },
    { id: 'reviews', label: 'Human Reviews', color: '#a88cf8', data: [15, 22, 30, 45, 28, 52, Math.max(overview.reviews.length * 5, 60)] },
    { id: 'capabilities', label: 'Active Capabilities', color: '#22c55e', data: [40, 42, 42, 45, 48, 50, overview.capabilities.length] },
  ];

  const donutSegments = [
    { id: 'comms', label: 'Communications', value: 42, color: '#facc15' },
    { id: 'gov', label: 'Governance & Audits', value: 31, color: '#a88cf8' },
    { id: 'lead', label: 'Lead Capture', value: 18, color: '#22c55e' },
    { id: 'learning', label: 'Learning Engine', value: 9, color: '#3b82f6' },
  ];

  return <>
    <section className={styles.pageHeading} aria-labelledby="page-title"><div><p className={styles.eyebrow}>Business overview</p><h1 id="page-title">Overview</h1><p>A governed view of your organizations, capabilities, and company knowledge.</p></div></section>
    <WiringBanner source={overview.source} />
    <section className={styles.metricGrid} aria-label="Workspace metrics">{overview.metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>

    {/* Real-time Motion Telemetry Section */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, margin: '16px 0' }}>
      <MotionAreaChart
        title="24-Hour System Event Volume"
        subtitle="Throughput across governed execution, reviews, and capability updates"
        categories={categories}
        series={series}
        height={180}
      />
      <MotionDonutChart
        title="System Resource Share"
        subtitle="Active domain workload distribution across workspace"
        segments={donutSegments}
        centerLabel="Active Workload"
      />
    </div>

    <div className={styles.dashboardGrid}>
      <section className={[styles.panel,styles.panelWide].join(" ")} aria-labelledby="capabilities-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Capability fabric</p><h2 id="capabilities-title">Recently changed</h2></div><Link href={"/capabilities"+context} className={styles.textButton}>View all →</Link></div><CapabilityTable capabilities={overview.capabilities.slice(0,3)} query="" /></section>
      <section className={styles.panel} aria-labelledby="review-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Human review</p><h2 id="review-title">Decision queue</h2></div><span className={styles.countBadge}>{overview.reviews.length}</span></div><ReviewQueue reviews={overview.reviews} /></section>
      <section className={styles.panel} aria-labelledby="modules-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Tenant products</p><h2 id="modules-title">Apps & modules</h2></div><Link href={"/modules/learning"+context} className={styles.textButton}>Manage →</Link></div><div className={styles.panelBody}>Review plan entitlement, installation state and activation for shared tenant modules such as Learning.</div></section>
    </div>
    <section className={[styles.panel,styles.activityPanel].join(" ")} aria-labelledby="activity-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Traceability</p><h2 id="activity-title">Latest governed activity</h2></div><Link href={"/audit"+context} className={styles.textButton}>Open audit →</Link></div><ActivityTimeline items={overview.activity} /></section>
  </>;
}
