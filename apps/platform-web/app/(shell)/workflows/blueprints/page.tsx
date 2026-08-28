import React from 'react';
import styles from '../../page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { type RouteSearchParams } from '../../../../lib/request-context';
import { BlueprintAuthoring } from '../BlueprintAuthoring';
import type { BlueprintSummary } from '../../../../lib/workflow-blueprints';

export default async function WorkflowBlueprintsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === 'string') qs.set('account', params.account);
  if (typeof params.org === 'string') qs.set('org', params.org);
  const q = qs.toString() ? `?${qs.toString()}` : '';

  const blueprints = await fetchApi<{ blueprints: BlueprintSummary[] }>(`/api/blueprints${q}`);
  if (isDenied(blueprints)) return <DeniedState result={blueprints} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Decision Fabric</p>
          <h1 id="page-title">Workflow Blueprints</h1>
          <p>Customize the platform lifecycle for your workspace: clone a platform blueprint into a draft, then publish it to run your own stages.</p>
        </div>
      </section>

      <BlueprintAuthoring blueprints={blueprints.blueprints} queryString={q} />
    </>
  );
}
