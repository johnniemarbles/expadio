import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { parseProductModuleShellDescriptor } from '@expadio/ui';
import { ModuleWorkspaceFrame } from '../../../components/ModuleWorkspaceFrame';
import { resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';

export default async function LeadManagementLayout({ children }: { children: React.ReactNode }) {
  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) => loadTenantProductModule(client, {
    tenantId: context.tenantId,
    moduleKey: 'lead-management',
  }));
  const descriptor = module ? parseProductModuleShellDescriptor({
    moduleKey: module.moduleKey,
    displayName: module.displayName,
    description: module.description,
    manifest: module.manifest,
  }) : null;
  if (!descriptor) return <>{children}</>;
  return <ModuleWorkspaceFrame descriptor={descriptor}>{children}</ModuleWorkspaceFrame>;
}
