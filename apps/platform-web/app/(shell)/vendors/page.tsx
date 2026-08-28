import React from 'react';
import styles from '../workflows/page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { type RouteSearchParams } from '../../../lib/request-context';
import { VendorsClient, type VendorRow } from './VendorsClient';

export default async function VendorsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === 'string') qs.set('account', params.account);
  if (typeof params.org === 'string') qs.set('org', params.org);
  const q = qs.toString() ? `?${qs.toString()}` : '';

  const vendors = await fetchApi<VendorRow[]>(`/api/vendors${q}`);
  if (isDenied(vendors)) return <DeniedState result={vendors} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Decision Fabric</p>
          <h1 id="page-title">Vendor Onboarding</h1>
          <p>A non-CRM business process on the same governed engine: register a vendor, screen it, and activate it — every step gated and traced.</p>
        </div>
      </section>

      <VendorsClient initialVendors={vendors} queryString={q} />
    </>
  );
}
