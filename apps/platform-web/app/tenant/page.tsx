import type { Metadata } from 'next';
import TenantWorkspace from './workspace';

export const metadata: Metadata = { title: 'EXPADIO · Brand workspace', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function TenantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  return <TenantWorkspace key={query.toString()} query={query.toString()} />;
}
