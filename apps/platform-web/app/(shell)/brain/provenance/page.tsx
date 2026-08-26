import { brainFixtureAdapter } from '@/lib/brain-fixture-adapter';
import { WiringBanner, EmptyState, DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { ProvenanceTimeline } from '@/components/brain/ProvenanceTimeline';

export default async function BrainProvenancePage() {
  const orgId = 'org_dreamware';
  const provenanceResult = await brainFixtureAdapter.loadProvenance(orgId);
  
  if (isDenied(provenanceResult)) {
    return <DeniedState result={provenanceResult} />;
  }

  const isFixture = true;
  const provenance = provenanceResult;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {isFixture && <WiringBanner source={{ kind: "fixture", label: "Fixture data", capturedAt: "" }} />}
      
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
