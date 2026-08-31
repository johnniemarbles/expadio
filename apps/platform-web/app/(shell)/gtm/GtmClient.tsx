'use client';

import { useEffect, useState } from 'react';

/**
 * AutoGTM console on EXPADIO.
 * File drafts, start DF review, assign reviewer, APPROVE, then persist a
 * COMMUNICATE intent. Prospects are scored locally. Replies are classified
 * on the server. This page never sends and never imports a lab adapter.
 */

type IcpRow = {
  icp_id: string;
  name: string;
  status: string;
  review_status: string;
  stage_key: string | null;
  workflow_instance_id: string | null;
};

type SequenceRow = {
  sequence_id: string;
  name: string;
  status: string;
  stage_key: string | null;
  workflow_instance_id: string | null;
};

type CampaignRow = {
  campaign_id: string;
  name: string;
  status: string;
  stage_key: string | null;
  workflow_instance_id: string | null;
};

type MeetingRow = {
  meeting_request_id: string;
  prospect_email: string;
  summary: string;
  status: string;
  stage_key: string | null;
  workflow_instance_id: string | null;
};

type ReplyRow = {
  reply_id: string;
  from_email: string;
  proposed_class: string;
  created_at: string;
};

type ProspectRow = {
  observation_id: string;
  fit_score: number;
  status: string;
  payload: { email?: string; title?: string; score?: { band?: string } };
};

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const r = data as Record<string, unknown>;
    if (typeof r.error === 'string') return r.error;
    if (typeof r.message === 'string') return r.message;
  }
  return fallback;
}

export function GtmClient() {
  const [icps, setIcps] = useState<IcpRow[]>([]);
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [name, setName] = useState('');
  const [brandId, setBrandId] = useState('');
  const [prospectEmail, setProspectEmail] = useState('');
  const [prospectTitle, setProspectTitle] = useState('Head of Operations');
  const [meetingSummary, setMeetingSummary] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [touchSubject, setTouchSubject] = useState('Northwind — a sharper ops loop');
  const [touchBody, setTouchBody] = useState('Hi Priya');
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    const [i, s, c, m, r, p] = await Promise.all([
      fetch('/api/gtm/icps'),
      fetch('/api/gtm/sequences'),
      fetch('/api/gtm/campaigns'),
      fetch('/api/gtm/meeting-requests'),
      fetch('/api/gtm/replies'),
      fetch('/api/gtm/prospects'),
    ]);
    if (i.ok) setIcps(await i.json());
    if (s.ok) setSequences(await s.json());
    if (c.ok) setCampaigns(await c.json());
    if (m.ok) setMeetings(await m.json());
    if (r.ok) setReplies(await r.json());
    if (p.ok) setProspects(await p.json());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function file(kind: 'icp' | 'sequence' | 'campaign') {
    setBusy(kind);
    setError(null);
    try {
      const path = kind === 'icp' ? '/api/gtm/icps' : kind === 'sequence' ? '/api/gtm/sequences' : '/api/gtm/campaigns';
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, brandId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not file.'));
      setName('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not file.');
    } finally {
      setBusy(null);
    }
  }

  async function startReview(kind: 'icps' | 'sequences' | 'campaigns' | 'meeting-requests', id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/gtm/${kind}/${encodeURIComponent(id)}/workflow`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not start review.'));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start review.');
    } finally {
      setBusy(null);
    }
  }

  async function assignReviewer(
    kind: 'icps' | 'sequences' | 'campaigns' | 'meeting-requests',
    id: string,
    stageKey: string,
    participantKey: string,
  ) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/gtm/${kind}/${encodeURIComponent(id)}/workflow/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageKey, participantKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not assign reviewer.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not assign reviewer.');
    } finally {
      setBusy(null);
    }
  }

  async function decide(
    kind: 'icps' | 'sequences' | 'campaigns' | 'meeting-requests',
    id: string,
    outcome: 'APPROVE' | 'REJECT',
  ) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/gtm/${kind}/${encodeURIComponent(id)}/workflow/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not record the decision.'));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the decision.');
    } finally {
      setBusy(null);
    }
  }

  async function fileIntent(sequenceId: string) {
    setBusy(sequenceId);
    setError(null);
    setLastIntent(null);
    try {
      const res = await fetch(`/api/gtm/sequences/${encodeURIComponent(sequenceId)}/communicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepKey: 'touch-1',
          subject: touchSubject,
          body: touchBody,
          recipientEmail: prospectEmail || 'priya.shah@northwind-plants.example',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not file Communication intent.'));
      setLastIntent(
        `persisted=${String(data.persisted)} dispatched=${String(data.dispatched)} sent=${String(data.sent)} reason=${data.reasonKey ?? ''} id=${data.actionIntentId ?? ''}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not file Communication intent.');
    } finally {
      setBusy(null);
    }
  }

  async function fileMeeting() {
    setBusy('meeting');
    setError(null);
    try {
      const res = await fetch('/api/gtm/meeting-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, prospectEmail, summary: meetingSummary }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not file meeting request.'));
      setMeetingSummary('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not file meeting request.');
    } finally {
      setBusy(null);
    }
  }

  async function observeProspect() {
    setBusy('prospect');
    setError(null);
    try {
      const res = await fetch('/api/gtm/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId,
          email: prospectEmail,
          title: prospectTitle,
          industry: 'software',
          icpId: icps[0]?.icp_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not observe prospect.'));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not observe prospect.');
    } finally {
      setBusy(null);
    }
  }

  async function ingestReply() {
    setBusy('reply');
    setError(null);
    try {
      const res = await fetch('/api/gtm/replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId,
          fromEmail: prospectEmail,
          rawPayload: { body: replyBody },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not ingest reply.'));
      setReplyBody('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not ingest reply.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={{ padding: 24, maxWidth: 1100 }}>
      <p style={{ fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#64748b' }}>Demand Generation Control Plane</p>
      <h1>AutoGTM</h1>
      <p style={{ color: '#475569', maxWidth: 720 }}>
        Propose an ICP, sequence or campaign. Start review, assign a second-subject reviewer, APPROVE.
        After APPROVE, file a Communication intent on <code>communication.email.send</code> via <code>gtm.email</code>.
        Send stays dark until BYOC. Prospects are scored with <code>gtm-fit-v1</code>. Warm replies ingest as CRM leads with source <code>outbound_gtm</code>.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Brand UUID" value={brandId} onChange={(e) => setBrandId(e.target.value)} />
        <button type="button" disabled={busy !== null} onClick={() => file('icp')}>Propose ICP</button>
        <button type="button" disabled={busy !== null} onClick={() => file('sequence')}>File sequence draft</button>
        <button type="button" disabled={busy !== null} onClick={() => file('campaign')}>File campaign draft</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <input placeholder="Prospect email" value={prospectEmail} onChange={(e) => setProspectEmail(e.target.value)} />
        <input placeholder="Prospect title" value={prospectTitle} onChange={(e) => setProspectTitle(e.target.value)} />
        <button type="button" disabled={busy !== null} onClick={() => void observeProspect()}>Observe prospect</button>
        <input placeholder="Meeting summary" value={meetingSummary} onChange={(e) => setMeetingSummary(e.target.value)} />
        <button type="button" disabled={busy !== null} onClick={() => void fileMeeting()}>File meeting request</button>
        <input placeholder="Reply text" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} />
        <button type="button" disabled={busy !== null} onClick={() => void ingestReply()}>Ingest reply</button>
      </div>
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      {lastIntent && <p>Last intent: {lastIntent}</p>}

      <h2>ICP proposals</h2>
      <ul>
        {icps.map((row) => (
          <li key={row.icp_id}>
            {row.name} · {row.status}/{row.review_status} · {row.stage_key ?? 'unbound'}
            {' '}
            {row.workflow_instance_id === null ? (
              <button type="button" disabled={busy !== null} onClick={() => void startReview('icps', row.icp_id)}>Start review</button>
            ) : (
              <>
                <button type="button" disabled={busy !== null} onClick={() => void assignReviewer('icps', row.icp_id, 'GOVERNANCE_REVIEW', 'gtm_reviewer')}>Assign reviewer</button>
                <button type="button" disabled={busy !== null} onClick={() => void decide('icps', row.icp_id, 'APPROVE')}>APPROVE</button>
                <button type="button" disabled={busy !== null} onClick={() => void decide('icps', row.icp_id, 'REJECT')}>REJECT</button>
              </>
            )}
          </li>
        ))}
        {icps.length === 0 && <li>No ICP proposals yet.</li>}
      </ul>

      <h2>Sequence drafts</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input placeholder="Touch subject" value={touchSubject} onChange={(e) => setTouchSubject(e.target.value)} />
        <input placeholder="Touch body" value={touchBody} onChange={(e) => setTouchBody(e.target.value)} />
      </div>
      <ul>
        {sequences.map((row) => (
          <li key={row.sequence_id}>
            {row.name} · {row.status} · {row.stage_key ?? 'unbound'}
            {' '}
            {row.workflow_instance_id === null ? (
              <button type="button" disabled={busy !== null} onClick={() => void startReview('sequences', row.sequence_id)}>Start review</button>
            ) : (
              <>
                <button type="button" disabled={busy !== null} onClick={() => void assignReviewer('sequences', row.sequence_id, 'COPY_REVIEW', 'gtm_reviewer')}>Assign reviewer</button>
                <button type="button" disabled={busy !== null} onClick={() => void decide('sequences', row.sequence_id, 'APPROVE')}>APPROVE</button>
                <button type="button" disabled={busy !== null} onClick={() => void fileIntent(row.sequence_id)}>File Communication intent</button>
              </>
            )}
          </li>
        ))}
        {sequences.length === 0 && <li>No sequences yet.</li>}
      </ul>

      <h2>Campaign drafts</h2>
      <ul>
        {campaigns.map((row) => (
          <li key={row.campaign_id}>
            {row.name} · {row.status} · {row.stage_key ?? 'unbound'}
            {' '}
            {row.workflow_instance_id === null ? (
              <button type="button" disabled={busy !== null} onClick={() => void startReview('campaigns', row.campaign_id)}>Start review</button>
            ) : (
              <>
                <button type="button" disabled={busy !== null} onClick={() => void assignReviewer('campaigns', row.campaign_id, 'LAUNCH_REVIEW', 'gtm_reviewer')}>Assign reviewer</button>
                <button type="button" disabled={busy !== null} onClick={() => void decide('campaigns', row.campaign_id, 'APPROVE')}>APPROVE</button>
              </>
            )}
          </li>
        ))}
        {campaigns.length === 0 && <li>No campaigns yet.</li>}
      </ul>

      <h2>Prospect observations</h2>
      <ul>
        {prospects.map((row) => (
          <li key={row.observation_id}>
            {row.payload?.email ?? 'unknown'} · {row.payload?.title ?? ''} · score {row.fit_score} {row.payload?.score?.band ?? ''}
          </li>
        ))}
        {prospects.length === 0 && <li>No prospects observed yet.</li>}
      </ul>

      <h2>Meeting requests</h2>
      <ul>
        {meetings.map((row) => (
          <li key={row.meeting_request_id}>
            {row.prospect_email} · {row.summary} · {row.status} · {row.stage_key ?? 'unbound'}
            {' '}
            {row.workflow_instance_id === null ? (
              <button type="button" disabled={busy !== null} onClick={() => void startReview('meeting-requests', row.meeting_request_id)}>Start review</button>
            ) : (
              <>
                <button type="button" disabled={busy !== null} onClick={() => void assignReviewer('meeting-requests', row.meeting_request_id, 'OWNER_REVIEW', 'gtm_owner')}>Assign owner</button>
                <button type="button" disabled={busy !== null} onClick={() => void decide('meeting-requests', row.meeting_request_id, 'APPROVE')}>APPROVE</button>
              </>
            )}
          </li>
        ))}
        {meetings.length === 0 && <li>No meeting requests yet.</li>}
      </ul>

      <h2>Reply observations</h2>
      <ul>
        {replies.map((row) => (
          <li key={row.reply_id}>{row.from_email} · {row.proposed_class}</li>
        ))}
        {replies.length === 0 && <li>No replies ingested yet.</li>}
      </ul>
    </section>
  );
}
