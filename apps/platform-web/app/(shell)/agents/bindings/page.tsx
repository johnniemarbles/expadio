import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState, EmptyState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { type RouteSearchParams } from '../../../../lib/request-context';
import { BindingsClient } from './BindingsClient';

export default async function AgentBindingsPage({ searchParams: _searchParams }: { searchParams: RouteSearchParams }) {
  const bindings = await fetchApi<any[]>('/api/agents/bindings');
  if (isDenied(bindings)) return <DeniedState result={bindings} />;
  return <BindingsClient initial={bindings} />;
}
