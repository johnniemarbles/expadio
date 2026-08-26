import { requestedOrganizationId, type RouteSearchParams } from '@/lib/request-context';
import { brainFixtureAdapter } from '@/lib/brain-fixture-adapter';
import { WiringBanner, EmptyState, DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { CorrectionList } from '@/components/brain/CorrectionList';
import { brainFixtureSource } from '@/lib/brain-fixture-adapter';

export default async function BrainCorrectionsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const correctionsResult = await brainFixtureAdapter.loadCorrections(orgId);
  
  if (isDenied(correctionsResult)) {
    return <DeniedState result={correctionsResult} />;
  }

  const corrections = correctionsResult;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <WiringBanner source={brainFixtureSource} />
      
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink-950)', margin: '0 0 1rem' }}>
          Correction Proposals
        </h2>
        
        {corrections.length > 0 ? (
          <CorrectionList corrections={corrections} />
        ) : (
          <EmptyState 
            title="No Corrections Found" 
            description="There are currently no correction proposals in the system." 
          />
        )}
      </div>
    </div>
  );
}
