import { brainFixtureAdapter } from '@/lib/brain-fixture-adapter';
import { WiringBanner, EmptyState, DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { CorrectionList } from '@/components/brain/CorrectionList';

export default async function BrainReviewQueuePage() {
  const orgId = 'org_dreamware';
  const reviewQueueResult = await brainFixtureAdapter.loadReviewQueue(orgId);
  
  if (isDenied(reviewQueueResult)) {
    return <DeniedState result={reviewQueueResult} />;
  }

  const isFixture = true;
  const queue = reviewQueueResult;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {isFixture && <WiringBanner source={{ kind: "fixture", label: "Fixture data", capturedAt: "" }} />}
      
      <div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--brand)', margin: '0 0 1.5rem' }}>
          Review Queue
        </h2>
        
        {queue.length > 0 ? (
          <div style={{ background: 'var(--surface-soft)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--line)' }}>
            <CorrectionList corrections={queue} />
          </div>
        ) : (
          <EmptyState 
            title="All Caught Up!" 
            description="No items awaiting review." 
          />
        )}
      </div>
    </div>
  );
}
