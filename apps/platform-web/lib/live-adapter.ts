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
import { resolvePlatformSelfOrigin } from './self-origin';

async function getBaseUrl() {
  if (typeof window !== 'undefined') return '';

  let forwardedHost: string | null = null;
  let host: string | null = null;
  let forwardedProto: string | null = null;
  try {
    const headersList = await headers();
    forwardedHost = headersList.get('x-forwarded-host');
    host = headersList.get('host');
    forwardedProto = headersList.get('x-forwarded-proto');
  } catch {
    // Request headers are unavailable outside an active request.
  }

  return resolvePlatformSelfOrigin({
    railwayPublicDomain: process.env.RAILWAY_PUBLIC_DOMAIN,
    forwardedHost,
    host,
    forwardedProto,
    fallbackPublicUrl: process.env.NEXT_PUBLIC_APP_URL,
    nodeEnv: process.env.NODE_ENV,
  }) ?? '';
}

export async function fetchApi<T>(path: string): Promise<AdapterResult<T>> {
  try {
    const baseUrl = await getBaseUrl();
    if (!baseUrl && typeof window === 'undefined') {
      throw new Error(`Cannot perform SSR fetch to relative path ${path}. Base URL is empty.`);
    }
    let url = `${baseUrl}${path}`;
    
    // Preserve authentication and the workspace context already resolved by
    // Platform proxy.ts. These headers request a scope; API handlers still
    // verify membership before reading tenant data.
    const fetchOptions: RequestInit = {};
    if (typeof window === 'undefined') {
      try {
        const incoming = await headers();
        const forwarded = new Headers();
        for (const name of [
          'cookie',
          'authorization',
          'x-expadio-scope',
        ]) {
          const value = incoming.get(name);
          if (value) forwarded.set(name, value);
        }

        // SSR subrequests pass through proxy.ts again. Re-express the trusted
        // outer-request workspace as query selectors so the proxy can derive
        // fresh workspace headers instead of trusting forwarded x-expadio IDs.
        const tenantId = incoming.get('x-expadio-tenant-id');
        const organizationId = incoming.get('x-expadio-organization-id');
        const tenantSource = incoming.get('x-expadio-tenant-source');
        const organizationSource = incoming.get('x-expadio-organization-source');
        if (
          (tenantId && tenantSource === 'query')
          || (organizationId && organizationSource === 'query')
        ) {
          const scopedUrl = new URL(url);
          if (
            tenantId
            && tenantSource === 'query'
            && !scopedUrl.searchParams.has('account')
          ) {
            scopedUrl.searchParams.set('account', tenantId);
          }
          if (
            organizationId
            && organizationSource === 'query'
            && !scopedUrl.searchParams.has('org')
          ) {
            scopedUrl.searchParams.set('org', organizationId);
          }
          url = scopedUrl.toString();
        }

        fetchOptions.headers = forwarded;
      } catch {
        // API auth will return an explicit denial when no request context exists.
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
    const result = await fetchApi<PlatformWorkspaceContext>('/api/context');
    if ('denied' in (result as any)) return { accounts: [], organizations: [] };
    return result as PlatformWorkspaceContext;
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
