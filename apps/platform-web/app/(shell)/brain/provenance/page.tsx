import { requestedOrganizationId, type RouteSearchParams } from '@/lib/request-context';
import { liveBrainAdapter } from '@/lib/live-adapter';
import { WiringBanner, EmptyState, DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { ProvenanceTimeline } from '@/components/brain/ProvenanceTimeline';
import { liveBrainSource } from '@/lib/live-adapter';

export default async function BrainProvenancePage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const provenanceResult = await liveBrainAdapter.loadProvenance(orgId);
  
  if (isDenied(provenanceResult)) {
    return <DeniedState result={provenanceResult} />;
  }

  const provenance = provenanceResult;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <WiringBanner source={liveBrainSource} />
      
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink-950)', margin: '0 0 1rem' }}>
          Provenance & Audit Trail
        </h2>
        
        {provenance.length > 0 ? (
          <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <ProvenanceTimeline entries={provenance} />
          </div>
        ) : (
          <EmptyState 
            title="No Provenance Data" 
            description="No provenance entries found." 
          />
        )}
      </div>
    </div>
  );
}
