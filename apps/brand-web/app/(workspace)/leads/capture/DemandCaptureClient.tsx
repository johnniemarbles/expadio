'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from '../../workspace.module.css';

const STAGES = [
  'NEW_ENQUIRY','CONTACT_ATTEMPTED','CONTACTED','QUALIFICATION','QUALIFIED',
  'DISCOVERY_SCHEDULED','DISCOVERY_COMPLETED','OPPORTUNITY_EVALUATION',
  'APPLICATION_INVITED','APPLICATION_STARTED','APPLICATION_SUBMITTED','DUE_DILIGENCE',
  'APPROVAL','AGREEMENT','ACTIVATION','WON','LOST','DISQUALIFIED','NURTURE',
] as const;
const STATUSES = [
  'ACTIVE','WAITING_ON_LEAD','WAITING_INTERNAL','ON_HOLD','STALLED',
  'DISQUALIFIED','CONVERTED','LOST','ARCHIVED',
] as const;
const TERMINAL = new Set(['WON','LOST','DISQUALIFIED']);

type CaptureLead = {
  captureLeadId: string;
  organizationId: string;
  sourceKey: string;
  surface: string;
  title: string | null;
  email: string | null;
  stage: string;
  operationalStatus: string;
  ownerSubjectId: string | null;
  stageEnteredAt: string;
  closeReasonCode: string | null;
  closedAt: string | null;
  projectedToCrm: boolean;
  createdAt: string;
  updatedAt: string;
};

type InboxResponse = { organizationId: string; leads: CaptureLead[] };

type Notice = { kind: 'success' | 'error'; text: string } | null;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({}));
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export default function DemandCaptureClient() {
  const [leads, setLeads] = useState<CaptureLead[]>([]);
  const [stageFilter, setStageFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (stageFilter) params.set('stage', stageFilter);
      if (statusFilter) params.set('status', statusFilter);
      const response = await fetch(`/api/leads/capture${params.size ? `?${params}` : ''}`, { cache: 'no-store' });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Unable to load Demand Capture leads.');
      setLeads(Array.isArray((body as unknown as InboxResponse).leads) ? (body as unknown as InboxResponse).leads : []);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to load Demand Capture leads.' });
    } finally {
      setLoading(false);
    }
  }, [stageFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => ({
    visible: leads.length,
    unassigned: leads.filter((lead) => !lead.ownerSubjectId).length,
    waiting: leads.filter((lead) => lead.operationalStatus === 'WAITING_ON_LEAD' || lead.operationalStatus === 'WAITING_INTERNAL').length,
    terminal: leads.filter((lead) => TERMINAL.has(lead.stage)).length,
  }), [leads]);

  async function routeLead(lead: CaptureLead) {
    setWorkingId(lead.captureLeadId);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/capture/${encodeURIComponent(lead.captureLeadId)}/routing`, { method: 'POST' });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Routing denied.');
      const outcome = String(body.outcome ?? 'UNASSIGNED');
      const assignedSubjectId = typeof body.assignedSubjectId === 'string' ? body.assignedSubjectId : null;
      const explanation = typeof body.explanation === 'string' ? body.explanation : '';
      setNotice({
        kind: 'success',
        text: outcome === 'ASSIGNED'
          ? `Assigned to ${assignedSubjectId ?? 'eligible owner'}. ${explanation}`
          : `Lead remains explicitly unassigned. ${explanation}`,
      });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Routing failed.' });
    } finally {
      setWorkingId(null);
    }
  }

  async function transitionStage(lead: CaptureLead, form: FormData) {
    const stage = String(form.get('stage') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    const closeReasonCode = String(form.get('closeReasonCode') ?? '').trim();
    setWorkingId(lead.captureLeadId);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/capture/${encodeURIComponent(lead.captureLeadId)}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, reason: reason || undefined, closeReasonCode: closeReasonCode || undefined }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Stage transition denied.');
      setNotice({ kind: 'success', text: `Stage updated to ${String(body.stage ?? stage)}.` });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Stage transition failed.' });
    } finally {
      setWorkingId(null);
    }
  }

  async function transitionStatus(lead: CaptureLead, form: FormData) {
    const status = String(form.get('status') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    setWorkingId(lead.captureLeadId);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/capture/${encodeURIComponent(lead.captureLeadId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Status transition denied.');
      setNotice({ kind: 'success', text: `Operational status updated to ${String(body.operationalStatus ?? status)}.` });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Status transition failed.' });
    } finally {
      setWorkingId(null);
    }
  }

  return <>
    {notice ? <div className={styles.notice}><strong>{notice.kind === 'success' ? 'Updated' : 'Action failed'}</strong><p>{notice.text}</p></div> : null}

    <section className={styles.grid}>
      <article className={styles.metric}><div className={styles.metricLabel}>Visible capture leads</div><div className={styles.metricValue}>{metrics.visible}</div><div className={styles.metricDetail}>Current workspace scope</div></article>
      <article className={styles.metric}><div className={styles.metricLabel}>Unassigned</div><div className={styles.metricValue}>{metrics.unassigned}</div><div className={styles.metricDetail}>Explicit routing queue</div></article>
      <article className={styles.metric}><div className={styles.metricLabel}>Waiting</div><div className={styles.metricValue}>{metrics.waiting}</div><div className={styles.metricDetail}>Lead or internal dependency</div></article>
      <article className={styles.metric}><div className={styles.metricLabel}>Terminal</div><div className={styles.metricValue}>{metrics.terminal}</div><div className={styles.metricDetail}>Won, lost or disqualified</div></article>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Demand Capture inbox</h2><span className={styles.pill}>{loading ? 'LOADING' : `${leads.length} VISIBLE`}</span></div>
      <div className={styles.panelBody} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>Journey stage<select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="">All stages</option>{STAGES.map((stage) => <option value={stage} key={stage}>{stage}</option>)}</select></label>
        <label>Operational status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}</select></label>
        <button className={styles.secondaryButton} type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
      </div>

      {!loading && leads.length === 0 ? <div className={styles.empty}>No Demand Capture leads are visible for this filter in the selected organization scope.</div> : null}
      {leads.length > 0 ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Capture lead</th><th>Journey</th><th>Operational status</th><th>Source</th><th>Owner</th><th>CRM</th><th>Actions</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.captureLeadId}>
        <td><strong>{lead.title || lead.email || 'Inbound enquiry'}</strong><br /><small>{lead.email || 'No email'} · {new Date(lead.createdAt).toLocaleString()}</small></td>
        <td><span className={styles.pill}>{lead.stage}</span><br /><small>Entered {new Date(lead.stageEnteredAt).toLocaleString()}</small></td>
        <td><span className={styles.pill}>{lead.operationalStatus}</span>{lead.closeReasonCode ? <><br /><small>Close: {lead.closeReasonCode}</small></> : null}</td>
        <td>{lead.sourceKey}<br /><small>{lead.surface}</small></td>
        <td>{lead.ownerSubjectId ? <><strong>{lead.ownerSubjectId}</strong><br /><small>Governed assignment</small></> : <><span className={styles.pill}>UNASSIGNED</span><br /><small>No valid route selected</small></>}</td>
        <td>{lead.projectedToCrm ? 'Projected' : 'Capture only'}</td>
        <td style={{ minWidth: 320 }}>
          <Link className={styles.secondaryButton} href={`/leads/capture/${lead.captureLeadId}`} style={{ marginBottom: 8, display: 'inline-flex' }}>View detail</Link>
          <button className={styles.secondaryButton} type="button" onClick={() => void routeLead(lead)} disabled={workingId === lead.captureLeadId}>Route now</button>
          <form action={(form) => transitionStage(lead, form)} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            <select name="stage" defaultValue={lead.stage} disabled={workingId === lead.captureLeadId}>{STAGES.map((stage) => <option value={stage} key={stage}>{stage}</option>)}</select>
            <input name="reason" placeholder="Reason for skip/backward/nurture/reopen" maxLength={1000} disabled={workingId === lead.captureLeadId} />
            <input name="closeReasonCode" placeholder="Close reason for terminal stage" maxLength={120} disabled={workingId === lead.captureLeadId} />
            <button type="submit" disabled={workingId === lead.captureLeadId}>Change journey stage</button>
          </form>
          <form action={(form) => transitionStatus(lead, form)} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            <select name="status" defaultValue={lead.operationalStatus} disabled={workingId === lead.captureLeadId}>{STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}</select>
            <input name="reason" placeholder="Status change reason" required maxLength={1000} disabled={workingId === lead.captureLeadId} />
            <button type="submit" disabled={workingId === lead.captureLeadId}>Change operational status</button>
          </form>
        </td>
      </tr>)}</tbody></table></div> : null}
    </section>
  </>;
}
