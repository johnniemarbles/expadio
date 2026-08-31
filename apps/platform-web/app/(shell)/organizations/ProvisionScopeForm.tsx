'use client';

import { useState } from 'react';

type Result = {
  tenant?: string;
  brand?: string;
  location?: string;
  brandHref?: string;
  correlation?: string;
  communicate?: string;
  delivery?: string;
};

export default function ProvisionScopeForm() {
  const [tenantCode, setTenantCode] = useState('T-0001');
  const [brandCode, setBrandCode] = useState('B-0001');
  const [locationCode, setLocationCode] = useState('ALL');
  const [organizationLabel, setOrganizationLabel] = useState('Brand workspace');
  const [createTenant, setCreateTenant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Result & { message?: string; denied?: boolean };
      if (!response.ok || payload.denied) {
        throw new Error(payload.message ?? 'Unable to complete this Platform action.');
      }
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete this Platform action.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => event.preventDefault()} style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
      <label>
        Tenant code
        <input value={tenantCode} onChange={(event) => setTenantCode(event.target.value)} required />
      </label>
      <label>
        Brand code
        <input value={brandCode} onChange={(event) => setBrandCode(event.target.value)} required />
      </label>
      <label>
        Location code
        <input value={locationCode} onChange={(event) => setLocationCode(event.target.value)} required />
      </label>
      <label>
        Brand label
        <input value={organizationLabel} onChange={(event) => setOrganizationLabel(event.target.value)} />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={createTenant} onChange={(event) => setCreateTenant(event.target.checked)} />
        Create a new storage tenant (otherwise bind the current one)
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void post('/api/tenants/provision', {
            tenantCode,
            brandCode,
            locationCode,
            organizationLabel,
            createTenant,
          })
        }
      >
        {busy ? 'Working…' : 'Provision Brand scope'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void post('/api/tenants/cs104-observe', { tenantCode, brandCode })}
      >
        {busy ? 'Working…' : 'Seed CS-104 observation'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {result?.brandHref ? (
        <p>
          {result.correlation ? `CS-104 communicate ${result.communicate ?? ''} · delivery ${result.delivery ?? ''}. ` : null}
          Bound {result.tenant ?? tenantCode} / {result.brand ?? brandCode} / {result.location ?? locationCode}.{' '}
          <a href={result.brandHref}>Open Brand</a>
        </p>
      ) : null}
    </form>
  );
}
