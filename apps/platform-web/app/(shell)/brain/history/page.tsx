import { requestedOrganizationId, type RouteSearchParams } from '@/lib/request-context';
import { brainFixtureAdapter } from '@/lib/brain-fixture-adapter';
import { WiringBanner, ActivityTimeline, ActivityTimelineItem, EmptyState, DeniedState } from '@expadio/ui';
import type { PublicationEvent } from '@/lib/brain-contracts';
import { isDenied } from '@expadio/ui/contracts';
import { brainFixtureSource } from '@/lib/brain-fixture-adapter';

export default async function BrainHistoryPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const historyResult = await brainFixtureAdapter.loadPublicationHistory(orgId);
  
  if (isDenied(historyResult)) {
    return <DeniedState result={historyResult} />;
  }

  const history: PublicationEvent[] = historyResult;

  const timelineItems: ActivityTimelineItem[] = history.map((event: PublicationEvent) => ({
    id: event.id,
    actor: event.performedBy,
    action: event.action,
    target: `${event.sourceName} (v${event.version})`,
    time: event.timestamp,
    timeLabel: new Date(event.timestamp).toLocaleString()
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <WiringBanner source={brainFixtureSource} />
      
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink-950)', margin: '0 0 1rem' }}>
          Publication History
        </h2>
        
        {timelineItems.length > 0 ? (
          <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <ActivityTimeline items={timelineItems} />
          </div>
        ) : (
          <EmptyState 
            title="No History" 
            description="No publication events found." 
          />
        )}
      </div>
    </div>
  );
}
