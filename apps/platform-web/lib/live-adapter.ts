import {
  PlatformWorkspaceAdapter,
  PlatformOverview,
  PlatformWorkspaceContext,
  WorkspaceSection,
  CapabilitySummary,
  ReviewItem,
  ActivityItem,
  PlatformOrganization,
} from './contracts';
import {
  BrainWorkspaceAdapter,
  BrainOverview,
  BrainSource,
  ContextSlice,
  CorrectionProposal,
  PublicationEvent,
  ProvenanceEntry,
} from './brain-contracts';
import { headers } from 'next/headers';
import type { AdapterResult } from '@expadio/ui/contracts';

async function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
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
  } catch {
    /* outside request */
  }
  return process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '';
}

function denied(status: number): AdapterResult<never> {
  return {
    denied: true,
    reasonKey: status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR',
    message: 'This information could not be loaded. Please try again.',
  };
}

export async function fetchApi<T>(path: string): Promise<AdapterResult<T>> {
  try {
    const baseUrl = await getBaseUrl();
    if (!baseUrl && typeof window === 'undefined') return denied(500);
    const url = `${baseUrl}${path}`;
    const fetchOptions: RequestInit = { cache: 'no-store' };
    if (typeof window === 'undefined') {
      try {
        const headersList = await headers();
        const cookieHeader = headersList.get('cookie');
        if (cookieHeader) fetchOptions.headers = { Cookie: cookieHeader };
      } catch {
        /* no request cookies */
      }
    }
    const res = await fetch(url, fetchOptions);
    const data = (await res.json().catch(() => null)) as AdapterResult<T> | null;
    if (data && typeof data === 'object' && 'denied' in data && data.denied) return data;
    if (!res.ok) return denied(res.status);
    return data as T;
  } catch (err) {
    console.error(`Error fetching ${path}:`, err instanceof Error ? err.message : 'failed');
    return denied(500);
  }
}

export const liveWorkspaceSource = {
  kind: 'live' as const,
  label: 'Live Database',
  capturedAt: new Date().toISOString(),
};
export const liveBrainSource = {
  kind: 'live' as const,
  label: 'Live Knowledge Base',
  capturedAt: new Date().toISOString(),
};

export const liveWorkspaceAdapter: PlatformWorkspaceAdapter = {
  async loadOverview(organizationId: string) {
    const result = await fetchApi<PlatformOverview>(`/api/overview?organizationId=${organizationId}`);
    if (result && 'denied' in (result as object)) return result as AdapterResult<PlatformOverview>;
    return { ...(result as PlatformOverview), source: liveWorkspaceSource };
  },
  async loadWorkspaceContext() {
    const result = await fetchApi<PlatformWorkspaceContext>('/api/context');
    if (!result || 'denied' in (result as object)) return { accounts: [], organizations: [] };
    return result as PlatformWorkspaceContext;
  },
  async loadAllowedWorkspaces() {
    const result = await fetchApi<WorkspaceSection[]>('/api/workspaces');
    if (!result || 'denied' in (result as object) || !Array.isArray(result)) return [];
    return result;
  },
  async loadCapabilities() {
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
  async loadOverview() {
    return fetchApi<BrainOverview>('/api/brain');
  },
  async loadSources() {
    return fetchApi<BrainSource[]>('/api/brain/sources');
  },
  async loadSlices() {
    return fetchApi<ContextSlice[]>('/api/brain/slices');
  },
  async loadCorrections() {
    return fetchApi<CorrectionProposal[]>('/api/brain/corrections');
  },
  async loadReviewQueue() {
    return fetchApi<CorrectionProposal[]>('/api/brain/corrections');
  },
  async loadPublicationHistory(orgId: string) {
    return fetchApi<PublicationEvent[]>(`/api/brain/history?organizationId=${orgId}`);
  },
  async loadProvenance(orgId: string, sourceId?: string) {
    const params = new URLSearchParams({ organizationId: orgId });
    if (sourceId) params.set('sourceId', sourceId);
    return fetchApi<ProvenanceEntry[]>(`/api/brain/provenance?${params}`);
  },
};
