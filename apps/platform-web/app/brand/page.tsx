import type { Metadata } from 'next';
import { brandWorkspace, unresolvedShellScope } from '@expadio/tenancy';
import BrandWorkspace from './BrandWorkspace';

export const metadata: Metadata = { title: 'EXPADIO · Brand', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function BrandPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const workspace = brandWorkspace(unresolvedShellScope('brand'));
  return <BrandWorkspace query={query.toString()} nav={[...workspace.app.nav]} />;
}
