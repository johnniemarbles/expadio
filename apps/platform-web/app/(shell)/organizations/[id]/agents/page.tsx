import React from 'react';
import styles from '../../../../page.module.css';
import { fetchApi } from '../../../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { AgentsClient } from './AgentsClient';

export const dynamic = 'force-dynamic';

export default async function TenantAgentsPage({ params }: { params: { id: string } }) {
  const tenantId = params.id;
  
  // We can pass account=tenantId so the API resolves context for that specific tenant
  const [catalog, tools] = await Promise.all([
    fetchApi<any[]>(`/api/agents/catalog?account=${tenantId}`),
    fetchApi<any[]>(`/api/agents/tools?account=${tenantId}`)
  ]);

  if (isDenied(catalog)) return <DeniedState result={catalog} />;
  
  const toolsData = isDenied(tools) ? [] : tools;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="tenant-agents-title">
        <div>
          <p className={styles.eyebrow}>Tenant HQ</p>
          <h1 id="tenant-agents-title">Agent Provisioning</h1>
          <p>Assign agents and tool grants for this specific tenant.</p>
        </div>
      </section>
      <AgentsClient initialCatalog={catalog} initialTools={toolsData} tenantId={tenantId} />
    </>
  );
}
