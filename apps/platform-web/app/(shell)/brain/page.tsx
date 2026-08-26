import { requestedOrganizationId, type RouteSearchParams } from '@/lib/request-context';
import { liveBrainAdapter } from '@/lib/live-adapter';
import { WiringBanner, DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import styles from './page.module.css';
import { BrainHeroCard } from '@/components/brain/BrainHeroCard';
import { ProvenanceTimeline } from '@/components/brain/ProvenanceTimeline';
import { ProvenanceEntry } from '@/lib/brain-contracts';
import { liveBrainSource } from '@/lib/live-adapter';

export default async function BrainOverviewPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const overviewResult = await liveBrainAdapter.loadOverview(orgId);
  
  if (isDenied(overviewResult)) {
    return <DeniedState result={overviewResult} />;
  }

  const overview = overviewResult;
  
  let recentActivity: ProvenanceEntry[] = [];

  return (
    <div className={styles.container}>
      <WiringBanner source={liveBrainSource} />
      
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
