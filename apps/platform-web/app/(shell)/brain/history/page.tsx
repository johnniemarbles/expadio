import { requestedOrganizationId, type RouteSearchParams } from '@/lib/request-context';
import { liveBrainAdapter } from '@/lib/live-adapter';
import { WiringBanner, ActivityTimeline, ActivityTimelineItem, EmptyState, DeniedState } from '@expadio/ui';
import type { PublicationEvent } from '@/lib/brain-contracts';
import { isDenied } from '@expadio/ui/contracts';
import { liveBrainSource } from '@/lib/live-adapter';

export default async function BrainHistoryPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const historyResult = await liveBrainAdapter.loadPublicationHistory(orgId);
  
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
      <WiringBanner source={liveBrainSource} />
      
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink-950)', margin: '0 0 1rem' }}>
          Publication History
        </h2>
        
        {timelineItems.length > 0 ? (
          <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: "var(--theme-radius-card)", border: '1px solid var(--line)' }}>
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
