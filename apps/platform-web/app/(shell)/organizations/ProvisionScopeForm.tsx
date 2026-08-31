'use client';

import { useState } from 'react';

type Result = {
  tenant: string;
  brand: string;
  location: string;
  brandHref: string;
};

export default function ProvisionScopeForm() {
  const [tenantCode, setTenantCode] = useState('T-0001');
  const [brandCode, setBrandCode] = useState('B-0001');
  const [locationCode, setLocationCode] = useState('L-0001');
  const [organizationLabel, setOrganizationLabel] = useState('Brand workspace');
  const [createTenant, setCreateTenant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/tenants/provision', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantCode,
          brandCode,
          locationCode,
          organizationLabel,
          createTenant,
        }),
      });
      const body = (await response.json()) as Result & { message?: string; denied?: boolean };
      if (!response.ok || body.denied) {
        throw new Error(body.message ?? 'Unable to provision this scope.');
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to provision this scope.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
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
      <button type="submit" disabled={busy}>{busy ? 'Provisioning…' : 'Provision Brand scope'}</button>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <p>
          Bound {result.tenant} / {result.brand} / {result.location}.{' '}
          <a href={result.brandHref}>Open Brand</a>
        </p>
      ) : null}
    </form>
  );
}
