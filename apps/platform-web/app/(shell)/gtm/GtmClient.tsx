'use client';

import { useEffect, useMemo, useState } from 'react';
import { InlineErrorBanner, OperationalStateBoundary, resolveDashboardState } from '@expadio/ui';
import styles from './GtmClient.module.css';

type IcpRow = { icp_id: string; name: string; status: string; review_status: string; stage_key: string | null; workflow_instance_id: string | null };
type SequenceRow = { sequence_id: string; name: string; status: string; stage_key: string | null; workflow_instance_id: string | null };
type CampaignRow = { campaign_id: string; name: string; status: string; stage_key: string | null; workflow_instance_id: string | null };
type MeetingRow = { meeting_request_id: string; prospect_email: string; summary: string; status: string; stage_key: string | null; workflow_instance_id: string | null };
type ReplyRow = { reply_id: string; from_email: string; proposed_class: string; created_at: string };
type ProspectRow = { observation_id: string; fit_score: number; status: string; payload: { email?: string; title?: string; score?: { band?: string } } };
type WorkflowKind = 'icps' | 'sequences' | 'campaigns' | 'meeting-requests';

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const r = data as Record<string, unknown>;
    if (typeof r.error === 'string') return r.error;
    if (typeof r.message === 'string') return r.message;
  }
  return fallback;
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiError(data, fallback));
  return data as T;
}

function title(value: string | null | undefined): string {
  if (!value) return '—';
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusPill({ value }: { readonly value: string | null | undefined }) {
  return <span className={styles.pill}>{title(value)}</span>;
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
  const [prospectTitle, setProspectTitle] = useState('');
  const [meetingSummary, setMeetingSummary] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [touchSubject, setTouchSubject] = useState('');
  const [touchBody, setTouchBody] = useState('');
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const hasAnyData = icps.length + sequences.length + campaigns.length + meetings.length + replies.length + prospects.length > 0;
  const isConfigured = brandId.trim().length > 0 || hasAnyData;
  const dashboardState = useMemo(() => resolveDashboardState({
    loading,
    configured: isConfigured,
    error: error ? { code: 'GTM_CLIENT_ERROR', message: error, retryLabel: 'Reload' } : undefined,
  }), [error, isConfigured, loading]);

  async function refresh(initial = false) {
    if (initial) setLoading(true);
    setError(null);
    try {
      const [i, s, c, m, r, p] = await Promise.all([
        fetch('/api/gtm/icps'),
        fetch('/api/gtm/sequences'),
        fetch('/api/gtm/campaigns'),
        fetch('/api/gtm/meeting-requests'),
        fetch('/api/gtm/replies'),
        fetch('/api/gtm/prospects'),
      ]);
      setIcps(await readJson<IcpRow[]>(i, 'Could not load ICP proposals.'));
      setSequences(await readJson<SequenceRow[]>(s, 'Could not load sequence drafts.'));
      setCampaigns(await readJson<CampaignRow[]>(c, 'Could not load campaign drafts.'));
      setMeetings(await readJson<MeetingRow[]>(m, 'Could not load meeting requests.'));
      setReplies(await readJson<ReplyRow[]>(r, 'Could not load replies.'));
      setProspects(await readJson<ProspectRow[]>(p, 'Could not load prospects.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load AutoGTM.');
    } finally {
      if (initial) setLoading(false);
    }
  }

  useEffect(() => { void refresh(true); }, []);

  async function mutate(key: string, run: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await run();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AutoGTM action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function file(kind: 'icp' | 'sequence' | 'campaign') {
    const path = kind === 'icp' ? '/api/gtm/icps' : kind === 'sequence' ? '/api/gtm/sequences' : '/api/gtm/campaigns';
    await mutate(kind, async () => {
      await readJson<unknown>(await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, brandId }) }), 'Could not file draft.');
      setName('');
      await refresh();
    });
  }

  async function startReview(kind: WorkflowKind, id: string) {
    await mutate(id, async () => {
      await readJson<unknown>(await fetch(`/api/gtm/${kind}/${encodeURIComponent(id)}/workflow`, { method: 'POST' }), 'Could not start review.');
      await refresh();
    });
  }

  async function assignReviewer(kind: WorkflowKind, id: string, stageKey: string, participantKey: string) {
    await mutate(id, async () => {
      await readJson<unknown>(await fetch(`/api/gtm/${kind}/${encodeURIComponent(id)}/workflow/participants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stageKey, participantKey }) }), 'Could not assign reviewer.');
      await refresh();
    });
  }

  async function decide(kind: WorkflowKind, id: string, outcome: 'APPROVE' | 'REJECT') {
    await mutate(id, async () => {
      await readJson<unknown>(await fetch(`/api/gtm/${kind}/${encodeURIComponent(id)}/workflow/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome }) }), 'Could not record the decision.');
      await refresh();
    });
  }

  async function fileIntent(sequenceId: string) {
    if (!prospectEmail.trim()) {
      setError('Recipient email is required before filing a Communication intent.');
      return;
    }
    await mutate(sequenceId, async () => {
      setLastIntent(null);
      const data = await readJson<Record<string, unknown>>(await fetch(`/api/gtm/sequences/${encodeURIComponent(sequenceId)}/communicate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepKey: 'touch-1', subject: touchSubject, body: touchBody, recipientEmail: prospectEmail }) }), 'Could not file Communication intent.');
      setLastIntent(`persisted=${String(data.persisted)} dispatched=${String(data.dispatched)} sent=${String(data.sent)} reason=${String(data.reasonKey ?? '—')} id=${String(data.actionIntentId ?? '—')}`);
    });
  }

  async function fileMeeting() {
    await mutate('meeting', async () => {
      await readJson<unknown>(await fetch('/api/gtm/meeting-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId, prospectEmail, summary: meetingSummary }) }), 'Could not file meeting request.');
      setMeetingSummary('');
      await refresh();
    });
  }

  async function observeProspect() {
    await mutate('prospect', async () => {
      await readJson<unknown>(await fetch('/api/gtm/prospects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId, email: prospectEmail, title: prospectTitle, icpId: icps[0]?.icp_id }) }), 'Could not observe prospect.');
      await refresh();
    });
  }

  async function ingestReply() {
    await mutate('reply', async () => {
      await readJson<unknown>(await fetch('/api/gtm/replies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId, fromEmail: prospectEmail, rawPayload: { body: replyBody } }) }), 'Could not ingest reply.');
      setReplyBody('');
      await refresh();
    });
  }

  return (
    <OperationalStateBoundary state={dashboardState} onRetry={() => void refresh(true)}>
      <section className={styles.root} aria-labelledby="gtm-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Demand Generation Control Plane</p>
            <h1 id="gtm-title" className={styles.title}>AutoGTM</h1>
            <p className={styles.description}>Govern ICPs, sequences, campaigns, meeting requests, prospect observations, and reply ingestion through the workflow and communication-intent path. Approved touches persist a <code>communication.email.send</code> intent through <code>gtm.email</code>; interested replies continue into CRM with the real source key <code>outbound_gtm</code>. No message is sent from this surface.</p>
          </div>
          <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void refresh(true)}>Refresh</button>
        </header>

        {!isConfigured ? (
          <section className={styles.callout} aria-labelledby="gtm-setup-title"><h2 id="gtm-setup-title">Configure a Brand context to start</h2><p>Enter the Brand UUID used by the GTM APIs, then file an ICP, sequence, or campaign draft. Metrics remain suppressed until live records exist.</p></section>
        ) : (
          <section className={styles.grid} aria-label="AutoGTM operational counts">
            <article className={styles.card}><div className={styles.metricLabel}>ICP proposals</div><div className={styles.metricValue}>{icps.length}</div><div className={styles.metricDetail}>Workflow-governed ICP drafts</div></article>
            <article className={styles.card}><div className={styles.metricLabel}>Sequences</div><div className={styles.metricValue}>{sequences.length}</div><div className={styles.metricDetail}>Communication intent candidates</div></article>
            <article className={styles.card}><div className={styles.metricLabel}>Prospects</div><div className={styles.metricValue}>{prospects.length}</div><div className={styles.metricDetail}>Observed fit signals</div></article>
            <article className={styles.card}><div className={styles.metricLabel}>Replies</div><div className={styles.metricValue}>{replies.length}</div><div className={styles.metricDetail}>Inbound classifications</div></article>
          </section>
        )}

        {error ? <InlineErrorBanner error={{ code: 'GTM_ACTION_ERROR', message: error, retryLabel: 'Reload' }} onRetry={() => void refresh(true)} /> : null}
        {lastIntent ? <p className={styles.intent}>Last intent: {lastIntent}</p> : null}

        <section className={styles.panel} aria-labelledby="gtm-drafts-title"><div className={styles.panelHead}><div><p className={styles.eyebrow}>Drafting</p><h2 id="gtm-drafts-title">File governed GTM drafts</h2></div></div><div className={styles.panelBody}><div className={styles.formGrid}><div className={styles.field}><label htmlFor="gtm-name">Draft name</label><input id="gtm-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter a governed draft name" /></div><div className={styles.field}><label htmlFor="gtm-brand">Brand UUID</label><input id="gtm-brand" value={brandId} onChange={(event) => setBrandId(event.target.value)} placeholder="Brand context UUID" /></div></div><div className={styles.actionRow}><button type="button" className={styles.button} disabled={busy !== null || !name.trim() || !brandId.trim()} onClick={() => void file('icp')}>Propose ICP</button><button type="button" className={styles.secondaryButton} disabled={busy !== null || !name.trim() || !brandId.trim()} onClick={() => void file('sequence')}>File sequence draft</button><button type="button" className={styles.secondaryButton} disabled={busy !== null || !name.trim() || !brandId.trim()} onClick={() => void file('campaign')}>File campaign draft</button></div></div></section>

        <section className={styles.panel} aria-labelledby="gtm-prospect-title"><div className={styles.panelHead}><div><p className={styles.eyebrow}>Signals</p><h2 id="gtm-prospect-title">Prospects, meetings, and replies</h2></div></div><div className={styles.panelBody}><div className={styles.formGrid}><div className={styles.field}><label htmlFor="gtm-email">Prospect email</label><input id="gtm-email" value={prospectEmail} onChange={(event) => setProspectEmail(event.target.value)} placeholder="Recipient or sender email" /></div><div className={styles.field}><label htmlFor="gtm-title-field">Prospect title</label><input id="gtm-title-field" value={prospectTitle} onChange={(event) => setProspectTitle(event.target.value)} placeholder="Known role title" /></div><div className={styles.field}><label htmlFor="gtm-meeting">Meeting summary</label><input id="gtm-meeting" value={meetingSummary} onChange={(event) => setMeetingSummary(event.target.value)} placeholder="Summarize the request" /></div><div className={styles.field}><label htmlFor="gtm-reply">Reply body</label><textarea id="gtm-reply" value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Paste received reply text" /></div></div><div className={styles.actionRow}><button type="button" className={styles.button} disabled={busy !== null || !brandId.trim() || !prospectEmail.trim()} onClick={() => void observeProspect()}>Observe prospect</button><button type="button" className={styles.secondaryButton} disabled={busy !== null || !brandId.trim() || !prospectEmail.trim() || !meetingSummary.trim()} onClick={() => void fileMeeting()}>File meeting request</button><button type="button" className={styles.secondaryButton} disabled={busy !== null || !brandId.trim() || !prospectEmail.trim() || !replyBody.trim()} onClick={() => void ingestReply()}>Ingest reply</button></div></div></section>

        <section className={styles.panel} aria-labelledby="gtm-touch-title"><div className={styles.panelHead}><div><p className={styles.eyebrow}>Communication intent</p><h2 id="gtm-touch-title">Sequence touch payload</h2></div></div><div className={styles.panelBody}><div className={styles.formGrid}><div className={styles.field}><label htmlFor="gtm-subject">Touch subject</label><input id="gtm-subject" value={touchSubject} onChange={(event) => setTouchSubject(event.target.value)} placeholder="Subject from approved sequence" /></div><div className={styles.field}><label htmlFor="gtm-body">Touch body</label><textarea id="gtm-body" value={touchBody} onChange={(event) => setTouchBody(event.target.value)} placeholder="Body from approved sequence" /></div></div></div></section>

        <section className={styles.panel} aria-labelledby="gtm-icps-title"><div className={styles.panelHead}><div><p className={styles.eyebrow}>Review fabric</p><h2 id="gtm-icps-title">ICP proposals</h2></div><span className={styles.pill}>{icps.length} records</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Name</th><th>Status</th><th>Stage</th><th>Actions</th></tr></thead><tbody>{icps.map((row) => <tr key={row.icp_id}><td><strong>{row.name}</strong></td><td><StatusPill value={`${row.status}/${row.review_status}`} /></td><td>{row.stage_key ?? '—'}</td><td><div className={styles.actionRow}>{row.workflow_instance_id === null ? <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void startReview('icps', row.icp_id)}>Start review</button> : <><button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void assignReviewer('icps', row.icp_id, 'GOVERNANCE_REVIEW', 'gtm_reviewer')}>Assign reviewer</button><button type="button" className={styles.button} disabled={busy !== null} onClick={() => void decide('icps', row.icp_id, 'APPROVE')}>Approve</button><button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void decide('icps', row.icp_id, 'REJECT')}>Reject</button></>}</div></td></tr>)}{icps.length === 0 ? <tr><td colSpan={4} className={styles.empty}>No ICP proposals yet.</td></tr> : null}</tbody></table></div></section>

        <section className={styles.panel} aria-labelledby="gtm-sequences-title"><div className={styles.panelHead}><div><p className={styles.eyebrow}>Sequences</p><h2 id="gtm-sequences-title">Sequence drafts</h2></div><span className={styles.pill}>{sequences.length} records</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Name</th><th>Status</th><th>Stage</th><th>Actions</th></tr></thead><tbody>{sequences.map((row) => <tr key={row.sequence_id}><td><strong>{row.name}</strong></td><td><StatusPill value={row.status} /></td><td>{row.stage_key ?? '—'}</td><td><div className={styles.actionRow}>{row.workflow_instance_id === null ? <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void startReview('sequences', row.sequence_id)}>Start review</button> : <><button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void assignReviewer('sequences', row.sequence_id, 'COPY_REVIEW', 'gtm_reviewer')}>Assign reviewer</button><button type="button" className={styles.button} disabled={busy !== null} onClick={() => void decide('sequences', row.sequence_id, 'APPROVE')}>Approve</button><button type="button" className={styles.secondaryButton} disabled={busy !== null || !touchSubject.trim() || !touchBody.trim() || !prospectEmail.trim()} onClick={() => void fileIntent(row.sequence_id)}>File Communication intent</button></>}</div></td></tr>)}{sequences.length === 0 ? <tr><td colSpan={4} className={styles.empty}>No sequence drafts yet.</td></tr> : null}</tbody></table></div></section>

        <section className={styles.panel} aria-labelledby="gtm-campaigns-title"><div className={styles.panelHead}><div><p className={styles.eyebrow}>Campaigns</p><h2 id="gtm-campaigns-title">Campaign drafts</h2></div><span className={styles.pill}>{campaigns.length} records</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Name</th><th>Status</th><th>Stage</th><th>Actions</th></tr></thead><tbody>{campaigns.map((row) => <tr key={row.campaign_id}><td><strong>{row.name}</strong></td><td><StatusPill value={row.status} /></td><td>{row.stage_key ?? '—'}</td><td><div className={styles.actionRow}>{row.workflow_instance_id === null ? <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void startReview('campaigns', row.campaign_id)}>Start review</button> : <><button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void assignReviewer('campaigns', row.campaign_id, 'LAUNCH_REVIEW', 'gtm_reviewer')}>Assign reviewer</button><button type="button" className={styles.button} disabled={busy !== null} onClick={() => void decide('campaigns', row.campaign_id, 'APPROVE')}>Approve</button></>}</div></td></tr>)}{campaigns.length === 0 ? <tr><td colSpan={4} className={styles.empty}>No campaign drafts yet.</td></tr> : null}</tbody></table></div></section>

        <section className={styles.panel} aria-labelledby="gtm-signals-title"><div className={styles.panelHead}><div><p className={styles.eyebrow}>Observed demand</p><h2 id="gtm-signals-title">Prospects, meetings, and replies</h2></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Type</th><th>Subject</th><th>Status</th><th>Detail</th></tr></thead><tbody>{prospects.map((row) => <tr key={row.observation_id}><td>Prospect</td><td><strong>{row.payload?.email ?? '—'}</strong></td><td><StatusPill value={row.status} /></td><td>Score {row.fit_score} · {row.payload?.score?.band ?? '—'} · {row.payload?.title ?? '—'}</td></tr>)}{meetings.map((row) => <tr key={row.meeting_request_id}><td>Meeting</td><td><strong>{row.prospect_email}</strong></td><td><StatusPill value={row.status} /></td><td>{row.summary || '—'} · {row.stage_key ?? '—'}</td></tr>)}{replies.map((row) => <tr key={row.reply_id}><td>Reply</td><td><strong>{row.from_email}</strong></td><td><StatusPill value={row.proposed_class} /></td><td>{row.created_at}</td></tr>)}{prospects.length + meetings.length + replies.length === 0 ? <tr><td colSpan={4} className={styles.empty}>No prospect, meeting, or reply signals yet.</td></tr> : null}</tbody></table></div></section>
      </section>
    </OperationalStateBoundary>
  );
}
