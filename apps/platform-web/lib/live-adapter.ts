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
import { headers } from 'next/headers';
import type { AdapterResult } from '@expadio/ui/contracts';

// Helper to construct absolute URLs for Server Components
async function getBaseUrl() {
  if (typeof window !== 'undefined') return ''; // Browser uses relative URLs
  
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  
  // Railway specific environment variable
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  
  try {
    const headersList = await headers();
    const host = headersList.get('x-forwarded-host') || headersList.get('host');
    if (host) {
      const protocol = host.includes('localhost') ? 'http' : 'https';
      return `${protocol}://${host}`;
    }
  } catch (e) {
    // Fallback if headers() fails (e.g., outside request context)
  }
  return process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '';
}

async function fetchApi<T>(path: string): Promise<AdapterResult<T>> {
  try {
    const baseUrl = await getBaseUrl();
    if (!baseUrl && typeof window === 'undefined') {
      throw new Error(`Cannot perform SSR fetch to relative path ${path}. Base URL is empty.`);
    }
    const url = `${baseUrl}${path}`;
    
    // Forward headers (specifically cookies) if running on the server
    const fetchOptions: RequestInit = {};
    if (typeof window === 'undefined') {
      try {
        const headersList = await headers();
        const cookieHeader = headersList.get('cookie');
        if (cookieHeader) {
          fetchOptions.headers = { 'Cookie': cookieHeader };
        }
      } catch (e) {
        // Fallback
      }
    }

    const res = await fetch(url, fetchOptions);
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        return { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'User is not authenticated' };
      }
      if (res.status === 403 && data && data.denied) {
        return data as AdapterResult<T>; // Return the DeniedResult gracefully to the UI
      }
      throw new Error(`API error: ${res.status}`);
    }
    if (data && data.denied) {
      return data;
    }
    return data as T;
  } catch (err) {
    console.error(`Error fetching ${path}:`, err);
    throw err;
  }
}

export const liveWorkspaceSource = { kind: 'live' as const, label: 'Live Database', capturedAt: new Date().toISOString() };
export const liveBrainSource = { kind: 'live' as const, label: 'Live Knowledge Base', capturedAt: new Date().toISOString() };

export const liveWorkspaceAdapter: PlatformWorkspaceAdapter = {
  async loadOverview(organizationId: string) {
    const result = await fetchApi<PlatformOverview>(`/api/overview?organizationId=${organizationId}`);
    if (result && 'denied' in (result as any)) return result as any;
    const overview = result as PlatformOverview;
    return {
      ...overview,
      source: liveWorkspaceSource as any
    };
  },
  async loadWorkspaceContext() {
    // TODO: Wire to /api/context when full account + org listing is available
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
    return fetchApi<ReviewItem[]>(`/api/governance/reviews?organizationId=${orgId}`);
  },
  async loadActivity(orgId: string) {
    return fetchApi<ActivityItem[]>(`/api/activity?organizationId=${orgId}`);
  },
  async loadOrganization(orgId: string) {
    return fetchApi<PlatformOrganization>(`/api/organizations?id=${orgId}`);
  },
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
    return fetchApi<PublicationEvent[]>(`/api/brain/history?organizationId=${orgId}`);
  },
  async loadProvenance(orgId: string, sourceId?: string) {
    const params = new URLSearchParams({ organizationId: orgId });
    if (sourceId) params.set('sourceId', sourceId);
    return fetchApi<ProvenanceEntry[]>(`/api/brain/provenance?${params}`);
  }
};
