import { brainFixtureAdapter } from '@/lib/brain-fixture-adapter';
import { WiringBanner, EmptyState, DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { SliceCard } from '@/components/brain/SliceCard';

export default async function BrainSlicesPage() {
  const orgId = 'org_dreamware';
  const slicesResult = await brainFixtureAdapter.loadSlices(orgId);
  
  if (isDenied(slicesResult)) {
    return <DeniedState result={slicesResult} />;
  }

  const isFixture = true;
  const slices = slicesResult;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {isFixture && <WiringBanner source={{ kind: "fixture", label: "Fixture data", capturedAt: "" }} />}
      
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink-950)', margin: '0 0 1rem' }}>
          Context Slices
        </h2>
        
        {slices.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
            {slices.map(slice => (
              <SliceCard key={slice.id} slice={slice} />
            ))}
          </div>
        ) : (
          <EmptyState 
            title="No Slices Found" 
            description="There are currently no context slices defined." 
          />
        )}
      </div>
    </div>
  );
}
