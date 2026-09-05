import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { type RouteSearchParams } from '../../../../lib/request-context';
import { CatalogClient } from './CatalogClient';

export const dynamic = 'force-dynamic';

export default async function AgentCatalogPage({ searchParams: _sp }: { searchParams: RouteSearchParams }) {
  const data = await fetchApi<any[]>('/api/agents/catalog');
  if (isDenied(data)) return <DeniedState result={data} />;
  return <CatalogClient initial={data} />;
}
