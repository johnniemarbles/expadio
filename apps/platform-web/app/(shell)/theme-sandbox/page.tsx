import { redirect } from 'next/navigation';
import { loadBrandAppOrigin, brandHandoffUrl } from '../../../lib/brand-app';
import { resolveRequestContext } from '../../../lib/request-context';

export const dynamic = 'force-dynamic';

export default async function ThemeSandboxHandoff() {
  const context = await resolveRequestContext();
  const brandOrigin = loadBrandAppOrigin();
  
  if (!brandOrigin) {
    throw new Error('Brand App Origin is not configured. Cannot redirect to Theme Sandbox.');
  }

  if (!context.organizationId) {
    throw new Error('An active organization is required to open the Theme Sandbox.');
  }

  const url = brandHandoffUrl(brandOrigin, {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    returnTo: '/theme-demo'
  });

  redirect(url);
}
