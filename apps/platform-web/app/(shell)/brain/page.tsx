import { brainFixtureAdapter } from '@/lib/brain-fixture-adapter';
import { WiringBanner, DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import styles from './page.module.css';
import { BrainHeroCard } from '@/components/brain/BrainHeroCard';
import { ProvenanceTimeline } from '@/components/brain/ProvenanceTimeline';
import { ProvenanceEntry } from '@/lib/brain-contracts';

export default async function BrainOverviewPage() {
  const orgId = 'org_dreamware';
  const overviewResult = await brainFixtureAdapter.loadOverview(orgId);
  const provenanceResult = await brainFixtureAdapter.loadProvenance(orgId);
  
  if (isDenied(overviewResult)) {
    return <DeniedState result={overviewResult} />;
  }

  const isFixture = true;
  const overview = overviewResult;
  
  let recentActivity: ProvenanceEntry[] = [];
  if (!isDenied(provenanceResult)) {
    recentActivity = provenanceResult.slice(0, 5);
  }

  return (
    <div className={styles.container}>
      {isFixture && <WiringBanner source={{ kind: "fixture", label: "Fixture data", capturedAt: "" }} />}
      
      <BrainHeroCard overview={overview} />
      
      <div className={styles.activitySection}>
        <h2 className={styles.sectionTitle}>Recent Knowledge Activity</h2>
        <div className={styles.card}>
          <ProvenanceTimeline entries={recentActivity} />
        </div>
      </div>
    </div>
  );
}
