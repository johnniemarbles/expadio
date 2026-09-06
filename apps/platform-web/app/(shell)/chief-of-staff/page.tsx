import React from 'react';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../lib/request-context';
import { ChiefOfStaffClient } from './ChiefOfStaffClient';

export default async function ChiefOfStaffPage({ searchParams }: { searchParams: RouteSearchParams }) {
  await requestedOrganizationId(searchParams);
  const data = await fetchApi<{ missions: any[]; tasks: any[]; approvals: any[]; readyAgentCount: number; readyAgents: any[] }>('/api/agent/missions');

  if (isDenied(data)) return <DeniedState result={data} />;

  return <ChiefOfStaffClient initialData={data} />;
}
