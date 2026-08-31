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
  deliveryClaimed?: boolean;
  payloadScan?: string;
  sourceLogScan?: string;
  runtimeLogFile?: string;
  cache?: string;
  source?: string;
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

  async function call(path: string, init?: RequestInit) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(path, { cache: 'no-store', ...init });
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
      <button type="button" disabled={busy} onClick={() => void call('/api/tenants/provision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, brandCode, locationCode, organizationLabel, createTenant }) })}>
        {busy ? 'Working…' : 'Provision Brand scope'}
      </button>
      <button type="button" disabled={busy} onClick={() => void call('/api/tenants/cs104-observe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, brandCode }) })}>
        {busy ? 'Working…' : 'Seed CS-104 observation'}
      </button>
      <button type="button" disabled={busy} onClick={() => void call(`/api/journey-correlation?tenant=${encodeURIComponent(tenantCode)}&brand=${encodeURIComponent(brandCode)}&correlation=CS-104`)}>
        {busy ? 'Working…' : 'Read CS-104 on Platform'}
      </button>
      <button type="button" disabled={busy} onClick={() => void call(`/api/tenants/delivery-proof?tenant=${encodeURIComponent(tenantCode)}&brand=${encodeURIComponent(brandCode)}`)}>
        {busy ? 'Working…' : 'Read provider delivery'}
      </button>
      <button type="button" disabled={busy} onClick={() => void call('/api/tenants/pii-proof')}>
        {busy ? 'Working…' : 'Run source PII proof'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <p>
          {result.payloadScan ? `PII proof ${result.payloadScan}. Logs ${result.runtimeLogFile ?? ''}. ` : null}
          {result.source === 'communication_deliveries' ? `Provider delivery ${result.delivery ?? ''} · claimed ${String(result.deliveryClaimed)}. ` : null}
          {result.correlation && result.source !== 'communication_deliveries' ? `CS-104 communicate ${result.communicate ?? ''} · delivery ${result.delivery ?? ''}. ` : null}
          {result.tenant || result.brandHref ? `Bound ${result.tenant ?? tenantCode} / ${result.brand ?? brandCode}. ` : null}
          {result.brandHref ? <a href={result.brandHref}>Open Brand</a> : null}
        </p>
      ) : null}
    </form>
  );
}
