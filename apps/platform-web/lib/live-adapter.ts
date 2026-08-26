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

export const livePlatformAdapter: PlatformWorkspaceAdapter = {
  async loadOverview(organizationId: string) {
    // For now we don't have a dedicated API route for platform overview, returning empty/mock or you can implement a route later
    // The requirement only asked for specific routes. We'll return dummy here or call a route if it existed.
    return {
      organization: { id: organizationId, name: 'Live Org', environment: 'production', level: 'platform', parentId: null },
      source: { kind: 'live', label: 'Live Environment', capturedAt: new Date().toISOString() },
      metrics: [], capabilities: [], reviews: [], activity: []
    } as any; 
  },
  async loadWorkspaceContext() {
    return { accounts: [], organizations: [] };
  },
  async loadAllowedWorkspaces() {
    const result = await fetchApi<WorkspaceSection[]>('/api/workspaces');
    if ('denied' in result) return [];
    return result;
  },
  async loadCapabilities(orgId: string) {
    return fetchApi<CapabilitySummary[]>('/api/capabilities');
  },
  async loadReviews(orgId: string) {
    return []; // Route not explicitly requested
  },
  async loadActivity(orgId: string) {
    return []; // Route not explicitly requested
  },
  async loadOrganization(orgId: string) {
    return { id: orgId, name: 'Live Org', environment: 'production', level: 'platform', parentId: null } as any; // Route not explicitly requested
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
    return fetchApi<CorrectionProposal[]>('/api/brain/corrections'); // reusing for now
  },
  async loadPublicationHistory(orgId: string) {
    return []; // Route not explicitly requested
  },
  async loadProvenance(orgId: string, sourceId?: string) {
    return []; // Route not explicitly requested
  }
};
