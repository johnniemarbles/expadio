import { requestedOrganizationId, type RouteSearchParams } from '@/lib/request-context';
import { brainFixtureAdapter } from '@/lib/brain-fixture-adapter';
import { WiringBanner, EmptyState, DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { SourceTable } from '@/components/brain/SourceTable';
import { brainFixtureSource } from '@/lib/brain-fixture-adapter';

export default async function BrainSourcesPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const sourcesResult = await brainFixtureAdapter.loadSources(orgId);
  
  if (isDenied(sourcesResult)) {
    return <DeniedState result={sourcesResult} />;
  }

  const sources = sourcesResult;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <WiringBanner source={brainFixtureSource} />
      
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink-950)', margin: '0 0 1rem' }}>
          Approved Sources
        </h2>
        {sources.length > 0 ? (
          <SourceTable sources={sources} />
        ) : (
          <EmptyState 
            title="No Sources Found" 
            description="There are currently no approved sources in the company brain." 
          />
        )}
      </div>
    </div>
  );
}
