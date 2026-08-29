import React from 'react';
import styles from '../../workflows/page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { type RouteSearchParams } from '../../../../lib/request-context';
import { WorkflowsClient, type GovernedInstance } from './WorkflowsClient';

export default async function GovernedWorkflowsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === 'string') qs.set('account', params.account);
  if (typeof params.org === 'string') qs.set('org', params.org);
  const q = qs.toString() ? `?${qs.toString()}` : '';

  const [payload, vertical] = await Promise.all([
    fetchApi<{ instances: GovernedInstance[] }>(`/api/governance/workflows${q}`),
    fetchApi<{ verticalKey: string | null }>(`/api/tenancy/vertical${q}`),
  ]);
  if (isDenied(payload)) return <DeniedState result={payload} />;
  const verticalKey = isDenied(vertical) ? null : vertical.verticalKey;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Governance</p>
          <h1 id="page-title">In-flight Workflows</h1>
          <p>Every open governed process across all verticals — case, vendor, expense, access request — the stage it currently sits at, and how long since it last moved. The live counterpart to the governed-decision log.</p>
        </div>
      </section>

      <WorkflowsClient initial={payload.instances ?? []} verticalKey={verticalKey} queryString={q} />
    </>
  );
}
