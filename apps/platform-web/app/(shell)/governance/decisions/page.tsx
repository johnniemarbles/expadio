import React from 'react';
import styles from '../../workflows/page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { type RouteSearchParams } from '../../../../lib/request-context';
import { DecisionsClient, type GovernedDecision } from './DecisionsClient';

export default async function GovernedDecisionsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === 'string') qs.set('account', params.account);
  if (typeof params.org === 'string') qs.set('org', params.org);
  const q = qs.toString() ? `?${qs.toString()}` : '';

  const [payload, vertical] = await Promise.all([
    fetchApi<{ decisions: GovernedDecision[] }>(`/api/governance/decisions${q}`),
    fetchApi<{ verticalKey: string | null }>(`/api/tenancy/vertical${q}`),
  ]);
  if (isDenied(payload)) return <DeniedState result={payload} />;
  const verticalKey = isDenied(vertical) ? null : vertical.verticalKey;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Governance</p>
          <h1 id="page-title">Governed Decisions</h1>
          <p>Every immutable stage decision across every vertical — case, vendor, expense — in one tenant-wide log. The append-only record of who approved what, with the authority and separation-of-duties evidence that cleared each one.</p>
        </div>
      </section>

      <DecisionsClient initial={payload.decisions ?? []} verticalKey={verticalKey} queryString={q} />
    </>
  );
}
