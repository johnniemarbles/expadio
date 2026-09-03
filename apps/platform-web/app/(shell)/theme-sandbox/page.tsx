import { redirect } from 'next/navigation';
import { loadBrandAppOrigin } from '../../../lib/brand-app';
import { resolveRequestContext } from '../../../lib/request-context';

export const dynamic = 'force-dynamic';

export default async function ThemeSandboxHandoff() {
  const context = await resolveRequestContext();
  const brandOrigin = loadBrandAppOrigin();
  
  if (!brandOrigin) {
    throw new Error('Brand App Origin is not configured. Cannot redirect to Theme Sandbox.');
  }

  // Use the same handoff logic format as ShellFrame uses for the brand app link
  const url = new URL('/handoff', brandOrigin);
  url.searchParams.set('tenant', context.subjectId);
  url.searchParams.set('returnTo', '/theme-demo');

  redirect(url.toString());
}
