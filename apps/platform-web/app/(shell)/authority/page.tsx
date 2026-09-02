import React from 'react';
import { PageHeader } from '@expadio/ui';
import { type RouteSearchParams } from '../../../lib/request-context';
import { AuthorityClient } from './AuthorityClient';

export default async function AuthorityPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === 'string') qs.set('account', params.account);
  if (typeof params.org === 'string') qs.set('org', params.org);
  const q = qs.toString() ? `?${qs.toString()}` : '';

  return (
    <>
      <PageHeader
        eyebrow="Decision Fabric"
        title="Approval Authority"
        description="Grant subjects the authority the decision gate enforces — a monetary approval ceiling, optionally scoped to an organization or delegated. This is what lets a governed decision carrying a monetary requirement actually clear."
      />

      <AuthorityClient queryString={q} />
    </>
  );
}
