'use client';
import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';
type Tab = 'home' | 'work' | 'customers';
type Status = 'Awaiting review' | 'Approved' | 'Scheduled' | 'Queued' | 'Delivered' | 'Failed';
const initialWork = [
  { id: 'w-1', title: 'Follow up with Jordan Lee', type: 'Customer follow-up', location: 'East District', status: 'Awaiting review' as Status, maker: 'You' },
  { id: 'w-2', title: 'Welcome sequence · Northstar', type: 'Communication', location: 'HQ', status: 'Scheduled' as Status, maker: 'Maya Chen' },
  { id: 'w-3', title: 'Case handoff · Priya Shah', type: 'Case task', location: 'West District', status: 'Delivered' as Status, maker: 'Leo Martin' },
];
const customers = [
  { id: 'c-1', name: 'Jordan Lee', location: 'East District', case: 'New customer onboarding', status: 'Awaiting review' },
  { id: 'c-2', name: 'Priya Shah', location: 'West District', case: 'Service follow-up', status: 'Delivered' },
  { id: 'c-3', name: 'Morgan Davis', location: 'HQ', case: 'Renewal conversation', status: 'Scheduled' },
];
export default function TenantWorkspacePage() {
  const [tab, setTab] = useState<Tab>('home'); const [location, setLocation] = useState('All permitted locations'); const [work, setWork] = useState(initialWork); const [message, setMessage] = useState(''); const [loading, setLoading] = useState(false);
  useEffect(() => { let active = true; setLoading(true); fetch('/api/tenant/work', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((rows) => { if (active && Array.isArray(rows) && rows.length) setWork(rows.map((row: any) => ({ id: row.work_item_id, title: row.title, type: row.work_type, location: row.location_id || 'Permitted location', status: row.status === 'AWAITING_REVIEW' ? 'Awaiting review' : row.status === 'OUTCOME_UNCERTAIN' ? 'Failed' : row.status.charAt(0) + row.status.slice(1).toLowerCase(), maker: row.maker_subject_id === 'current-user' ? 'You' : row.maker_subject_id || 'Team' }))); }).catch(() => undefined).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const visibleWork = useMemo(() => location === 'All permitted locations' ? work : work.filter((item) => item.location === location || item.location === 'HQ'), [location, work]);
  function submitForReview(id: string) { setWork((items) => items.map((item) => item.id === id ? { ...item, status: 'Awaiting review' } : item)); setMessage('Submitted for review. Another reviewer is required before approval.'); }
  return <main className={styles.page}>
    <div className={styles.fixture} role="status">Demo model tenant · Northstar Services · Fixture data, not production truth</div>
    <header className={styles.header}><div><p className={styles.eyebrow}>Tenant workspace</p><h1>Run the business through connected work.</h1><p className={styles.subhead}>One place for attention, customer work and communication outcomes.</p></div><label className={styles.scope}>Location scope<select value={location} onChange={(event) => setLocation(event.target.value)}><option>All permitted locations</option><option>East District</option><option>West District</option><option>HQ</option></select></label></header>
    <nav className={styles.tabs} aria-label="Tenant workspace">{(['home', 'work', 'customers'] as Tab[]).map((item) => <button key={item} type="button" className={tab === item ? styles.activeTab : styles.tab} onClick={() => setTab(item)}>{item === 'home' ? 'Home' : item === 'work' ? 'My work' : 'Customers'}</button>)}</nav>
    {loading ? <div className={styles.notice} role="status">Loading your work…</div> : null}
    {message ? <div className={styles.notice} role="status">{message}</div> : null}
    {tab === 'home' ? <section className={styles.stack}><div className={styles.metrics}><Metric label="Needs your attention" value="4" detail="2 approvals · 2 overdue tasks" /><Metric label="In progress" value="12" detail="Across permitted locations" /><Metric label="Completed by EXPADIO" value="28" detail="Last 7 days" /></div><div className={styles.grid}><Panel title="Needs your attention">{visibleWork.filter((item) => item.status === 'Awaiting review').map((item) => <WorkRow key={item.id} item={item} onAction={() => submitForReview(item.id)} />)}</Panel><Panel title="What is happening">{visibleWork.filter((item) => item.status !== 'Delivered').map((item) => <WorkRow key={item.id} item={item} />)}</Panel></div><Panel title="What the system already finished">{visibleWork.filter((item) => item.status === 'Delivered').map((item) => <WorkRow key={item.id} item={item} />)}</Panel></section> : null}
    {tab === 'work' ? <Panel title="My work"><div className={styles.workTabs}><span className={styles.selected}>My tasks (2)</span><span>Approvals (1)</span><span>Team queue (4)</span><span>Overdue (2)</span><span>Exceptions (1)</span></div>{visibleWork.map((item) => <WorkRow key={item.id} item={item} onAction={item.maker === 'You' ? () => submitForReview(item.id) : undefined} />)}</Panel> : null}
    {tab === 'customers' ? <Panel title="Customers"><p className={styles.caption}>Shared customer records connect activity, tasks, communications, documents and decisions.</p><div className={styles.customerList}>{customers.filter((item) => location === 'All permitted locations' || item.location === location || item.location === 'HQ').map((customer) => <button key={customer.id} type="button" className={styles.customer} onClick={() => setMessage(customer.name + ': Overview · Activity · Tasks · Communications · Documents · Decisions')}><span><strong>{customer.name}</strong><small>{customer.case} · {customer.location}</small></span><Status value={customer.status as Status} /></button>)}</div></Panel> : null}
  </main>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className={styles.panel}><h2>{title}</h2>{children}</section>; }
function Status({ value }: { value: Status }) { return <span className={styles.status}>{value}</span>; }
function WorkRow({ item, onAction }: { item: typeof initialWork[number]; onAction?: () => void }) { return <div className={styles.row}><div><strong>{item.title}</strong><small>{item.type} · {item.location} · {item.status === 'Awaiting review' ? 'Another reviewer required' : 'Updated just now'}</small></div><div className={styles.rowActions}><Status value={item.status} />{onAction ? <button type="button" className={styles.action} onClick={onAction}>{item.maker === 'You' ? 'Request review' : 'Open'}</button> : null}</div></div>; }
