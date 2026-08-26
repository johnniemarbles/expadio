import { 
  PlatformWorkspaceAdapter, 
  PlatformOverview, 
  PlatformWorkspaceContext, 
  WorkspaceSection, 
  CapabilitySummary, 
  ReviewItem, 
  ActivityItem, 
  PlatformOrganization 
} from './contracts';
import { 
  BrainWorkspaceAdapter, 
  BrainOverview, 
  BrainSource, 
  ContextSlice, 
  CorrectionProposal, 
  PublicationEvent, 
  ProvenanceEntry 
} from './brain-contracts';
import type { AdapterResult } from '@expadio/ui/contracts';

async function fetchApi<T>(url: string): Promise<AdapterResult<T>> {
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        return { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'User is not authenticated' };
      }
      throw new Error(`API error: ${res.status}`);
    }
    // If the data itself has `denied: true`, it might already be parsed
    if (data && data.denied) {
      return data;
    }
    return data as T;
  } catch (err) {
    console.error(`Error fetching ${url}:`, err);
    throw err;
  }
}

export const liveWorkspaceSource = { kind: 'live', label: 'Live Database', capturedAt: new Date().toISOString() };
export const liveBrainSource = { kind: 'live', label: 'Live Knowledge Base', capturedAt: new Date().toISOString() };

export const liveWorkspaceAdapter: PlatformWorkspaceAdapter = {
  async loadOverview(organizationId: string) {
    return {
      organization: { id: organizationId, name: 'Live Org', environment: 'production', level: 'platform', parentId: null },
      source: liveWorkspaceSource as any,
      metrics: [], capabilities: [], reviews: [], activity: []
    } as any; 
  },
  async loadWorkspaceContext() {
    return { accounts: [], organizations: [] };
  },
  async loadAllowedWorkspaces() {
    const result = await fetchApi<WorkspaceSection[]>('/api/workspaces');
    if ('denied' in (result as any)) return [];
    return result as WorkspaceSection[];
  },
  async loadCapabilities(orgId: string) {
    return fetchApi<CapabilitySummary[]>('/api/capabilities');
  },
  async loadReviews(orgId: string) {
    return []; 
  },
  async loadActivity(orgId: string) {
    return []; 
  },
  async loadOrganization(orgId: string) {
    return { id: orgId, name: 'Live Org', environment: 'production', level: 'platform', parentId: null } as any; 
  }
};

export const liveBrainAdapter: BrainWorkspaceAdapter = {
  async loadOverview(orgId: string) {
    return fetchApi<BrainOverview>('/api/brain');
  },
  async loadSources(orgId: string) {
    return fetchApi<BrainSource[]>('/api/brain/sources');
  },
  async loadSlices(orgId: string) {
    return fetchApi<ContextSlice[]>('/api/brain/slices');
  },
  async loadCorrections(orgId: string) {
    return fetchApi<CorrectionProposal[]>('/api/brain/corrections');
  },
  async loadReviewQueue(orgId: string) {
    return fetchApi<CorrectionProposal[]>('/api/brain/corrections'); 
  },
  async loadPublicationHistory(orgId: string) {
    return []; 
  },
  async loadProvenance(orgId: string, sourceId?: string) {
    return []; 
  }
};
