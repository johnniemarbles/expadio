import { brainFixtureAdapter } from '@/lib/brain-fixture-adapter';
import { WiringBanner, EmptyState, DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { SourceTable } from '@/components/brain/SourceTable';

export default async function BrainSourcesPage() {
  const orgId = 'org_dreamware';
  const sourcesResult = await brainFixtureAdapter.loadSources(orgId);
  
  if (isDenied(sourcesResult)) {
    return <DeniedState result={sourcesResult} />;
  }

  const isFixture = true;
  const sources = sourcesResult;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {isFixture && <WiringBanner source={{ kind: "fixture", label: "Fixture data", capturedAt: "" }} />}
      
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
