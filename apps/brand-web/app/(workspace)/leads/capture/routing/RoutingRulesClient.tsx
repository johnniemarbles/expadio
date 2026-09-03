'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../../../workspace.module.css';

type RoutingRule = {
  routingRuleId: string;
  name: string;
  priority: number;
  sourceId: string | null;
  sourceKey: string | null;
  targetSubjectId: string;
  status: 'ACTIVE' | 'DISABLED';
};

type Notice = { kind: 'success' | 'error'; text: string } | null;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({}));
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export default function RoutingRulesClient() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/leads/capture/routing-rules', { cache: 'no-store' });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Unable to load routing rules.');
      setRules(Array.isArray(body.rules) ? body.rules as unknown as RoutingRule[] : []);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to load routing rules.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createRule(form: FormData) {
    setWorking(true);
    setNotice(null);
    try {
      const payload = {
        name: String(form.get('name') ?? '').trim(),
        priority: Number(form.get('priority')),
        targetSubjectId: String(form.get('targetSubjectId') ?? '').trim(),
        sourceId: String(form.get('sourceId') ?? '').trim() || undefined,
      };
      const response = await fetch('/api/leads/capture/routing-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Unable to create routing rule.');
      setNotice({ kind: 'success', text: 'Routing rule created.' });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to create routing rule.' });
    } finally {
      setWorking(false);
    }
  }

  async function setStatus(rule: RoutingRule, status: 'ACTIVE' | 'DISABLED') {
    setWorking(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/capture/routing-rules/${encodeURIComponent(rule.routingRuleId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Unable to update routing rule.');
      setNotice({ kind: 'success', text: `${rule.name} is now ${status}.` });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to update routing rule.' });
    } finally {
      setWorking(false);
    }
  }

  return <>
    {notice ? <div className={styles.notice}><strong>{notice.kind === 'success' ? 'Updated' : 'Action failed'}</strong><p>{notice.text}</p></div> : null}

    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Create routing rule</h2><span className={styles.pill}>LOWER PRIORITY WINS</span></div>
      <form action={createRule} className={styles.panelBody} style={{ display: 'grid', gap: 10, maxWidth: 720 }}>
        <label>Rule name<input name="name" required maxLength={160} placeholder="Inbound website enquiries" disabled={working} /></label>
        <label>Priority<input name="priority" required type="number" min="0" max="100000" step="1" placeholder="10" disabled={working} /></label>
        <label>Target subject ID<input name="targetSubjectId" required maxLength={320} placeholder="user_..." disabled={working} /></label>
        <label>Capture source ID <small>(optional; blank applies to all sources)</small><input name="sourceId" placeholder="UUID" disabled={working} /></label>
        <button type="submit" disabled={working}>Create governed routing rule</button>
      </form>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Routing rules</h2><span className={styles.pill}>{loading ? 'LOADING' : `${rules.length} RULES`}</span></div>
      {!loading && rules.length === 0 ? <div className={styles.empty}>No routing rules exist. Route-now actions will produce an explicit UNASSIGNED outcome.</div> : null}
      {rules.length > 0 ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Priority</th><th>Rule</th><th>Source</th><th>Target</th><th>Status</th><th>Action</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.routingRuleId}>
        <td>{rule.priority}</td>
        <td><strong>{rule.name}</strong><br /><small>{rule.routingRuleId}</small></td>
        <td>{rule.sourceKey ?? 'All sources'}{rule.sourceId ? <><br /><small>{rule.sourceId}</small></> : null}</td>
        <td>{rule.targetSubjectId}</td>
        <td><span className={styles.pill}>{rule.status}</span></td>
        <td><button className={styles.secondaryButton} type="button" disabled={working} onClick={() => void setStatus(rule, rule.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}>{rule.status === 'ACTIVE' ? 'Disable' : 'Enable'}</button></td>
      </tr>)}</tbody></table></div> : null}
    </section>
  </>;
}
