import { BRAND_APP, brandHostStatus, parseBrandCode, parseLocationCode, parseTenantCode } from '@expadio/tenancy';

export const dynamic = 'force-dynamic';

export default async function BrandHome({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; brand?: string; location?: string }>;
}) {
  const params = await searchParams;
  const status = brandHostStatus('app.expadio.com');
  let scope = 'Open with tenant, brand and location product codes.';
  try {
    if (params.tenant && params.brand && params.location) {
      const tenant = parseTenantCode(params.tenant);
      const brand = parseBrandCode(params.brand);
      const location = params.location === 'ALL' ? 'ALL' : parseLocationCode(params.location);
      scope = `${tenant} / ${brand} / ${location}`;
    }
  } catch {
    scope = 'Use T-####, B-#### and ALL or L-####. UUIDs are not accepted.';
  }

  return (
    <main style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>
      <aside style={{ padding: 24, borderRight: '1px solid #2a2f3a' }}>
        <p style={{ margin: 0, fontWeight: 700 }}>
          EXPADIO
          <small style={{ display: 'block', fontWeight: 400, opacity: 0.7 }}>Brand</small>
        </p>
        <nav style={{ display: 'grid', gap: 8, marginTop: 24 }}>
          {BRAND_APP.nav.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </nav>
        <p style={{ marginTop: 24, fontSize: 12, opacity: 0.6 }}>app.expadio.com. Not Platform chrome.</p>
      </aside>
      <section style={{ padding: 32 }}>
        <p style={{ letterSpacing: '0.08em', fontSize: 12, opacity: 0.6 }}>BRAND HOST</p>
        <h1>Brand product host</h1>
        <p>{scope}</p>
        <p>
          Origin {status.publicOrigin}. Deployed {String(status.deployed)}. This package is the Brand app;
          it is not live until a Railway service serves {status.productHost}.
        </p>
        <p>Reads and CS-104 observation still run on the Platform fallback until this host is wired to the same APIs.</p>
      </section>
    </main>
  );
}
