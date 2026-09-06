import { listTenantProductModules } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../lib/brand-context';
import { listBrandLeads } from '../../lib/brand-leads';
import { loadBrandEnterpriseView } from '../../lib/enterprise-data';
import BrandHomeClient from './BrandHomeClient';

export const dynamic = 'force-dynamic';

export default async function BrandHome() {
  const context = await resolveBrandContext();
  const state = await withBrandTransaction(context, async (client) => ({
    modules: await listTenantProductModules(client, context.tenantId),
    enterprise: await loadBrandEnterpriseView(client, context),
    leads: await listBrandLeads(client, {}),
  }));

  return (
    <>
      {/* <h1>All Apps</h1> Enterprise control plane · Open Enterprise Hub */}
      <BrandHomeClient
        organizationName={context.organizationName ?? 'Brand Workspace'}
        tenantName={context.tenantName ?? 'Brand'}
        modules={state.modules}
        enterprise={state.enterprise}
        leads={state.leads}
      />
    </>
  );
}
