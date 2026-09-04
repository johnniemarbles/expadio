import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';
import BrandSettingsClient from './BrandSettingsClient';

export const dynamic = 'force-dynamic';

export default async function BrandSettingsPage() {
  const context = await resolveBrandContext();

  const settings = await withBrandTransaction(context, async (client) => {
    const row = await client.query<{
      brand_slug: string | null;
      brand_display_name: string | null;
      brand_domain: string | null;
      brand_domain_verified_at: Date | null;
    }>(
      `SELECT brand_slug, brand_display_name, brand_domain, brand_domain_verified_at
         FROM platform.organizations
        WHERE organization_id = $1::uuid`,
      [context.organizationId],
    );
    return row.rows[0] ?? null;
  });

  return <>
    <section className={styles.pageHead}>
      <div>
        <p className={styles.eyebrow}>Administration · {context.organizationName}</p>
        <h1>Brand settings</h1>
        <p>Set your brand identity and connect your own domain for enquiry forms.</p>
      </div>
    </section>

    <BrandSettingsClient
      initialSettings={{
        brandSlug: settings?.brand_slug ?? null,
        brandDisplayName: settings?.brand_display_name ?? null,
        brandDomain: settings?.brand_domain ?? null,
        brandDomainVerifiedAt: settings?.brand_domain_verified_at?.toISOString() ?? null,
      }}
    />
  </>;
}
