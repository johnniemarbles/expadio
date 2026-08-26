import styles from "./page.module.css";
import { fixtureWorkspaceAdapter } from "../../lib/fixture-adapter";
import { WiringBanner, MetricCard, ActivityTimeline, EmptyState } from "@expadio/ui";
import { ScopePicker } from "../../components/ScopePicker/ScopePicker";
import { CapabilityTable } from "../../components/CapabilityTable/CapabilityTable";
import { ReviewQueue } from "../../components/ReviewQueue/ReviewQueue";
import Link from "next/link";
import { isDenied } from "@expadio/ui/contracts";

export default async function OverviewPage() {
  const overview = await fixtureWorkspaceAdapter.loadOverview("org_dreamware");

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Command center</p>
          <h1 id="page-title">Overview</h1>
          <p>A governed view of your organizations, capabilities, and company knowledge.</p>
        </div>
        <ScopePicker organization={overview.organization} />
      </section>

      <WiringBanner source={overview.source} />

      <section className={styles.metricGrid} aria-label="Workspace metrics">
        {overview.metrics.map((metric) => (
          <MetricCard 
            key={metric.label}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
            tone={metric.tone}
          />
        ))}
      </section>

      <div className={styles.dashboardGrid}>
        <section className={`${styles.panel} ${styles.panelWide}`} aria-labelledby="capabilities-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Capability fabric</p>
              <h2 id="capabilities-title">Recently changed</h2>
            </div>
            <Link href="/capabilities" className={styles.textButton}>
              View all <span aria-hidden="true">→</span>
            </Link>
          </div>
          <CapabilityTable capabilities={overview.capabilities.slice(0, 3)} query="" />
        </section>

        <section className={styles.panel} aria-labelledby="review-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Human review</p>
              <h2 id="review-title">Decision queue</h2>
            </div>
            <span className={styles.countBadge}>{overview.reviews.length}</span>
          </div>
          <ReviewQueue reviews={overview.reviews} />
        </section>
      </div>

      <section className={`${styles.panel} ${styles.activityPanel}`} aria-labelledby="activity-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Traceability</p>
            <h2 id="activity-title">Latest governed activity</h2>
          </div>
          <Link href="/audit" className={styles.textButton}>
            Open audit <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ActivityTimeline items={overview.activity} />
      </section>
    </>
  );
}
