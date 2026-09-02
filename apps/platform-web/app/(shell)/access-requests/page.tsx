import React from 'react';
import { PageHeader } from '@expadio/ui';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { type RouteSearchParams } from '../../../lib/request-context';
import { AccessRequestsClient, type AccessRequestRow } from './AccessRequestsClient';

export default async function AccessRequestsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === 'string') qs.set('account', params.account);
  if (typeof params.org === 'string') qs.set('org', params.org);
  const q = qs.toString() ? `?${qs.toString()}` : '';

  const rows = await fetchApi<AccessRequestRow[]>(`/api/access-requests${q}`);
  if (isDenied(rows)) return <DeniedState result={rows} />;

  return (
    <>
      <PageHeader
        eyebrow="Decision Fabric"
        title="Access Requests"
        description="Request a system entitlement, route it to a security reviewer, and grant it through the same governed engine — approval gated by role and separation of duties, with every step traced."
      />

      <AccessRequestsClient initial={rows} queryString={q} />
    </>
  );
}
