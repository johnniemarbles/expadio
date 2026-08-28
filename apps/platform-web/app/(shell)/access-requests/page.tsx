import React from 'react';
import styles from '../workflows/page.module.css';
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
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Decision Fabric</p>
          <h1 id="page-title">Access Requests</h1>
          <p>A fourth governed process on the same engine: request a system entitlement, route it to a security reviewer, and grant it — the approval gated by role and separation of duties, every step traced.</p>
        </div>
      </section>

      <AccessRequestsClient initial={rows} queryString={q} />
    </>
  );
}
