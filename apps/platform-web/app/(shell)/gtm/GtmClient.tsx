'use client';

import { useEffect, useState } from 'react';

/**
 * AutoGTM console — Demand Generation Control Plane surface.
 * Files ICP proposals and campaign drafts. Publish/launch stay on Decision Fabric.
 * Send is Communication-owned; this page never calls a lab adapter.
 */

type IcpRow = {
  icp_id: string;
  name: string;
  status: string;
  review_status: string;
  stage_key: string | null;
  created_at: string;
};

type CampaignRow = {
  campaign_id: string;
  name: string;
  status: string;
  stage_key: string | null;
  created_at: string;
};

export function GtmClient() {
  const [icps, setIcps] = useState<IcpRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [name, setName] = useState('');
  const [brandId, setBrandId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [i, c] = await Promise.all([fetch('/api/gtm/icps'), fetch('/api/gtm/campaigns')]);
    if (i.ok) setIcps(await i.json());
    if (c.ok) setCampaigns(await c.json());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function file(kind: 'icp' | 'campaign') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(kind === 'icp' ? '/api/gtm/icps' : '/api/gtm/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, brandId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? data?.message ?? 'Could not file.');
      setName('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ padding: 24, maxWidth: 960 }}>
      <p style={{ fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#64748b' }}>Demand Generation Control Plane</p>
      <h1>AutoGTM</h1>
      <p style={{ color: '#475569', maxWidth: 640 }}>
        Propose an ICP or file a campaign draft. Reviewers approve in the Decision Fabric queue.
        Outbound send uses Communication <code>communication.email.send</code> via connector <code>gtm.email</code> (disabled until BYOC is bound). Warm replies ingest as CRM leads with source <code>outbound_gtm</code>.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Brand UUID" value={brandId} onChange={(e) => setBrandId(e.target.value)} />
        <button type="button" disabled={busy} onClick={() => file('icp')}>Propose ICP</button>
        <button type="button" disabled={busy} onClick={() => file('campaign')}>File campaign draft</button>
      </div>
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}

      <h2>ICP proposals</h2>
      <ul>
        {icps.map((row) => (
          <li key={row.icp_id}>{row.name} · {row.status}/{row.review_status} · {row.stage_key ?? 'unbound'}</li>
        ))}
        {icps.length === 0 && <li>No ICP proposals yet.</li>}
      </ul>

      <h2>Campaign drafts</h2>
      <ul>
        {campaigns.map((row) => (
          <li key={row.campaign_id}>{row.name} · {row.status} · {row.stage_key ?? 'unbound'}</li>
        ))}
        {campaigns.length === 0 && <li>No campaigns yet.</li>}
      </ul>
    </section>
  );
}
