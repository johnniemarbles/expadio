import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../../lib/request-context';
import { ChiefOfStaffClient } from '../../chief-of-staff/ChiefOfStaffClient';

export default async function BrainMissionsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  await requestedOrganizationId(searchParams);
  const data = await fetchApi<{ missions: any[]; tasks: any[]; approvals: any[] }>('/api/agent/missions');
  if (isDenied(data)) return <DeniedState result={data} />;
  return <ChiefOfStaffClient initialData={data} />;
}
