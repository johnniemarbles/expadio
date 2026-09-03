'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../../../workspace.module.css';

// ── Types ───────────────────────────────────────────────────────────────────

type Activity = {
  activityId: string;
  activityType: string;
  body: string | null;
  metadata: Record<string, unknown>;
  actorSubjectId: string | null;
  createdAt: string;
};

type Task = {
  taskId: string;
  title: string;
  body: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  escalatedAt: string | null;
  assigneeSubjectId: string | null;
  completedAt: string | null;
  createdAt: string;
};

type Lead = {
  captureLeadId: string;
  title: string | null;
  email: string | null;
  stage: string;
  operationalStatus: string;
  ownerSubjectId: string | null;
  verificationState: string;
  projectedToCrm: boolean;
  createdAt: string;
};

type Notice = { kind: 'success' | 'error'; text: string } | null;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const v = await r.json().catch(() => ({}));
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'var(--theme-text-muted)',
  MEDIUM: 'var(--theme-primary)',
  HIGH: 'var(--theme-warning)',
  URGENT: 'var(--theme-danger)',
};

// ── Subcomponents ────────────────────────────────────────────────────────────

function ActivityItem({ activity }: { activity: Activity }) {
  const meta = activity.metadata;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--theme-border)' }}>
      <div style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: 'var(--theme-primary)', marginTop: 6 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={styles.pill}>{activity.activityType}</span>
          <span style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>{fmtDate(activity.createdAt)}</span>
          {activity.actorSubjectId && (
            <span style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>{activity.actorSubjectId}</span>
          )}
        </div>
        {activity.body && (
          <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--theme-text-primary)' }}>{activity.body}</p>
        )}
        {activity.activityType === 'DISCOVERY' && (
          <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--theme-text-muted)' }}>
            {typeof meta.outcome === 'string' && `Outcome: ${meta.outcome}`}
            {typeof meta.duration_minutes === 'number' && ` · ${meta.duration_minutes}min`}
          </p>
        )}
        {activity.activityType === 'COMMUNICATION' && (
          <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--theme-text-muted)' }}>
            {typeof meta.channel === 'string' && `Channel: ${meta.channel}`}
            {typeof meta.direction === 'string' && ` · ${meta.direction}`}
          </p>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onStatusChange,
}: {
  task: Task;
  onStatusChange: (taskId: string, status: string) => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const isTerminal = task.status === 'DONE' || task.status === 'CANCELLED';

  async function cycle() {
    if (isTerminal || working) return;
    setWorking(true);
    await onStatusChange(task.taskId, task.status === 'OPEN' ? 'DONE' : 'OPEN');
    setWorking(false);
  }

  return (
    <div style={{
      border: '1px solid var(--theme-border)',
      borderRadius: 10,
      padding: 14,
      background: task.status === 'DONE' ? 'var(--theme-surface-muted)' : 'var(--theme-surface)',
      opacity: task.status === 'CANCELLED' ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <strong style={{ fontSize: 13, lineHeight: 1.4 }}>{task.title}</strong>
        <span style={{ fontSize: 11, fontWeight: 800, color: PRIORITY_COLORS[task.priority] ?? 'inherit', flexShrink: 0 }}>
          {task.priority}
        </span>
      </div>
      {task.body && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--theme-text-secondary)' }}>{task.body}</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <span className={styles.pill}>{task.status}</span>
        {task.dueAt && (
          <span style={{ fontSize: 11, color: task.escalatedAt ? 'var(--theme-danger)' : 'var(--theme-text-muted)' }}>
            Due {fmtDate(task.dueAt)}{task.escalatedAt && ' · ESCALATED'}
          </span>
        )}
        {!isTerminal && (
          <button
            onClick={cycle}
            disabled={working}
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 6, border: '1px solid var(--theme-border)', background: 'var(--theme-surface-muted)', color: 'var(--theme-text-secondary)' }}
          >
            {working ? '…' : task.status === 'DONE' ? 'Reopen' : 'Mark done'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Note form ─────────────────────────────────────────────────────────────

function AddNoteForm({ captureLeadId, onAdded }: { captureLeadId: string; onAdded: () => void }) {
  const [body, setBody] = useState('');
  const [working, setWorking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || working) return;
    setWorking(true);
    await fetch(`/api/leads/capture/${captureLeadId}/activities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'NOTE', body: body.trim() }),
    });
    setBody('');
    setWorking(false);
    onAdded();
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note…"
        rows={2}
        maxLength={2000}
        style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', resize: 'vertical', fontSize: 13 }}
      />
      <button type="submit" disabled={working || !body.trim()} className={styles.button} style={{ padding: '8px 14px', fontSize: 12 }}>
        {working ? '…' : 'Save'}
      </button>
    </form>
  );
}

// ── Add task form ──────────────────────────────────────────────────────────

function AddTaskForm({ captureLeadId, onAdded }: { captureLeadId: string; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [dueAt, setDueAt] = useState('');
  const [working, setWorking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || working) return;
    setWorking(true);
    await fetch(`/api/leads/capture/${captureLeadId}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), priority, ...(dueAt ? { dueAt } : {}) }),
    });
    setTitle('');
    setPriority('MEDIUM');
    setDueAt('');
    setWorking(false);
    onAdded();
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'end' }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title…"
        maxLength={200}
        required
        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13 }}
      />
      <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 12 }}>
        {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}
      </select>
      <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 12 }} />
      <button type="submit" disabled={working || !title.trim()} className={styles.button} style={{ padding: '8px 14px', fontSize: 12 }}>
        {working ? '…' : 'Add task'}
      </button>
    </form>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function LeadDetailClient({ captureLeadId }: { captureLeadId: string }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<'timeline' | 'tasks'>('timeline');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  const loadLead = useCallback(async () => {
    const r = await fetch(`/api/leads/capture/${captureLeadId}`, { cache: 'no-store' });
    const body = await readJson(r);
    if (body.lead) setLead(body.lead as Lead);
  }, [captureLeadId]);

  const loadActivities = useCallback(async () => {
    const r = await fetch(`/api/leads/capture/${captureLeadId}/activities`, { cache: 'no-store' });
    const body = await readJson(r);
    if (Array.isArray(body.activities)) setActivities(body.activities as Activity[]);
  }, [captureLeadId]);

  const loadTasks = useCallback(async () => {
    const r = await fetch(`/api/leads/capture/${captureLeadId}/tasks`, { cache: 'no-store' });
    const body = await readJson(r);
    if (Array.isArray(body.tasks)) setTasks(body.tasks as Task[]);
  }, [captureLeadId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadLead(), loadActivities(), loadTasks()]);
    setLoading(false);
  }, [loadLead, loadActivities, loadTasks]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function onTaskStatusChange(taskId: string, status: string) {
    try {
      const r = await fetch(`/api/leads/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        setNotice({ kind: 'error', text: 'Failed to update task.' });
        return;
      }
      await loadTasks();
    } catch {
      setNotice({ kind: 'error', text: 'Network error updating task.' });
    }
  }

  const openTasks = tasks.filter((t) => t.status === 'OPEN');
  const doneTasks = tasks.filter((t) => t.status === 'DONE');

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>Loading…</div>;

  return (
    <div>
      {/* Lead summary card */}
      {lead && (
        <div className={styles.panel} style={{ marginTop: 0 }}>
          <div className={styles.panelHead}>
            <h2>{lead.title ?? 'Untitled lead'}</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className={styles.pill}>{lead.stage}</span>
              <span className={styles.pill}>{lead.operationalStatus}</span>
              {lead.verificationState !== 'NOT_REQUIRED' && (
                <span className={styles.pill} style={{ background: lead.verificationState === 'VERIFIED' ? 'color-mix(in srgb,var(--theme-success) 14%,transparent)' : 'color-mix(in srgb,var(--theme-warning) 14%,transparent)', color: lead.verificationState === 'VERIFIED' ? 'var(--theme-success)' : 'var(--theme-warning)' }}>
                  {lead.verificationState}
                </span>
              )}
              {lead.projectedToCrm && <span className={styles.pill}>In CRM</span>}
            </div>
          </div>
          <div className={styles.panelBody} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 16, fontSize: 12 }}>
            <div><div style={{ color: 'var(--theme-text-muted)', fontWeight: 700, marginBottom: 4 }}>EMAIL</div>{lead.email ?? '—'}</div>
            <div><div style={{ color: 'var(--theme-text-muted)', fontWeight: 700, marginBottom: 4 }}>OWNER</div>{lead.ownerSubjectId ?? 'Unassigned'}</div>
            <div><div style={{ color: 'var(--theme-text-muted)', fontWeight: 700, marginBottom: 4 }}>CREATED</div>{fmtDate(lead.createdAt)}</div>
          </div>
        </div>
      )}

      {notice && (
        <div className={styles.notice} style={{ marginTop: 14, background: notice.kind === 'error' ? 'color-mix(in srgb,var(--theme-danger) 8%,var(--theme-surface))' : undefined }}>
          {notice.text}
          <button onClick={() => setNotice(null)} style={{ marginLeft: 12, fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--theme-text-muted)' }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.moduleTabs} style={{ marginTop: 20 }}>
        <button onClick={() => setTab('timeline')} style={{ all: 'unset', cursor: 'pointer', padding: '10px 12px', borderBottom: `2px solid ${tab === 'timeline' ? 'var(--theme-primary)' : 'transparent'}`, color: tab === 'timeline' ? 'var(--theme-primary)' : 'var(--theme-text-muted)', fontSize: 12, fontWeight: 700 }}>
          Timeline ({activities.length})
        </button>
        <button onClick={() => setTab('tasks')} style={{ all: 'unset', cursor: 'pointer', padding: '10px 12px', borderBottom: `2px solid ${tab === 'tasks' ? 'var(--theme-primary)' : 'transparent'}`, color: tab === 'tasks' ? 'var(--theme-primary)' : 'var(--theme-text-muted)', fontSize: 12, fontWeight: 700 }}>
          Tasks ({openTasks.length} open)
        </button>
      </div>

      {/* Timeline */}
      {tab === 'timeline' && (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Activity timeline</h2>
          </div>
          <div className={styles.panelBody}>
            <AddNoteForm captureLeadId={captureLeadId} onAdded={loadActivities} />
            <div style={{ marginTop: 16 }}>
              {activities.length === 0
                ? <div className={styles.empty}>No activity recorded yet.</div>
                : activities.map((a) => <ActivityItem key={a.activityId} activity={a} />)
              }
            </div>
          </div>
        </div>
      )}

      {/* Task board */}
      {tab === 'tasks' && (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Task board</h2>
          </div>
          <div className={styles.panelBody}>
            <AddTaskForm captureLeadId={captureLeadId} onAdded={loadTasks} />
            <div style={{ marginTop: 16 }}>
              {tasks.length === 0
                ? <div className={styles.empty}>No tasks yet.</div>
                : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--theme-text-muted)', marginBottom: 10 }}>Open ({openTasks.length})</div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {openTasks.map((t) => <TaskCard key={t.taskId} task={t} onStatusChange={onTaskStatusChange} />)}
                        {openTasks.length === 0 && <div className={styles.empty} style={{ padding: 14 }}>No open tasks</div>}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--theme-text-muted)', marginBottom: 10 }}>Done ({doneTasks.length})</div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {doneTasks.map((t) => <TaskCard key={t.taskId} task={t} onStatusChange={onTaskStatusChange} />)}
                        {doneTasks.length === 0 && <div className={styles.empty} style={{ padding: 14 }}>No completed tasks</div>}
                      </div>
                    </div>
                  </div>
                )
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
