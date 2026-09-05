import { fetchApi, isDenied, DeniedState } from '../../../../lib/server-fetch';
import { CatalogClient } from './CatalogClient';

export const dynamic = 'force-dynamic';

type RouteSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AgentCatalogPage({ searchParams: _sp }: { searchParams: RouteSearchParams }) {
  const data = await fetchApi<any[]>('/api/agents/catalog');
  if (isDenied(data)) return <DeniedState result={data} />;
  return <CatalogClient initial={data} />;
}
