'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { businessStatus } from '../../lib/tenant-contracts';
import type { Customer, CustomerDetail, CustomerTask, PageResult, TenantContext } from '../../lib/tenant-contracts';
import { modelCustomer } from '../../lib/tenant-model-fixture';
import styles from './workspace.module.css';

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };
class ReadFailure extends Error {}
function useRead<T>(url: string | null, model: T): [Load<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Load<T>>(url === null ? { state: 'ready', data: model } : { state: 'loading' });
  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    let current = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setResult({ state: 'loading' });
    void fetch(url, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) {
        const messages: Record<number, string> = {
          400: 'This workspace link is incomplete or invalid. Open a brand and organization from your workspace.',
          401: 'Your session has ended. Sign in again to continue.',
          403: 'This workspace is unavailable for your access. Location-restricted reads are not connected yet.',
          404: 'Customer not found in this workspace.',
        };
        throw new ReadFailure(messages[response.status] ?? 'Unable to load this information. Please try again.');
      }
      const data = await response.json() as T;
      if (current) setResult({ state: 'ready', data });
    }).catch((error: unknown) => {
      if (current) setResult({ state: 'error', message: controller.signal.aborted ? 'The request timed out. Please try again.' : error instanceof ReadFailure ? error.message : 'Unable to load this information. Please try again.' });
    }).finally(() => clearTimeout(timeout));
    return () => { current = false; controller.abort(); clearTimeout(timeout); };
  }, [url, attempt]);
  return [result, () => setAttempt(value => value + 1)];
}

const workspaces = [['home', 'Home'], ['work', 'My work'], ['customers', 'Customers'], ['communications', 'Communications'], ['growth', 'Growth'], ['knowledge', 'Knowledge & AI'], ['settings', 'Business settings']] as const;
const recordTabs = ['Overview', 'Activity', 'Tasks', 'Communications', 'Documents', 'Decisions'] as const;
const workTabs = ['My tasks', 'Approvals', 'Team queue', 'Overdue', 'Exceptions'] as const;

export default function TenantWorkspace({ query }: { query: string }) {
  const params = new URLSearchParams(query);
  const model = params.get('mode') === 'model';
  const requestedView = params.get('view') ?? 'home';
  const view = workspaces.some(([key]) => key === requestedView) ? requestedView : 'home';
  const scope = new URLSearchParams();
  for (const key of ['account', 'org', 'location', 'locationId', 'workspace', 'workspaceId']) {
    for (const value of params.getAll(key)) scope.append(key, value);
  }
  const hasScope = scope.has('account') && scope.has('org');
  function link(next: Record<string, string>) {
    const output = new URLSearchParams(scope);
    if (model) output.set('mode', 'model');
    for (const [key, value] of Object.entries(next)) output.set(key, value);
    return '/tenant?' + output.toString();
  }
  return <div className={styles.shell}>
    <a href="#tenant-main" className={styles.skip}>Skip to workspace</a>
    <aside className={styles.sidebar} aria-label="Brand workspace navigation">
      <a className={styles.brand} href={link({ view: 'home' })}><span aria-hidden="true">E</span><div>EXPADIO<small>Brand workspace</small></div></a>
      <nav aria-label="Workspaces">{workspaces.map(([key, label]) => <a key={key} href={link({ view: key })} aria-current={view === key ? 'page' : undefined}>{label}</a>)}</nav>
      <p className={styles.sidebarNote}>Your business, connected.<br />Execution and provider operations stay with EXPADIO.</p>
    </aside>
    <main id="tenant-main" className={styles.main}>
      {model ? <div className={styles.fixture}>Model tenant · Northstar Services · Read-only fixture, not live business data. No actions are saved or sent. <a href="/tenant">Exit model</a></div> : null}
      {!model && !hasScope ? <section className={styles.panel}><p className={styles.eyebrow}>Get started</p><h1>Open your brand workspace</h1><p>Use a workspace link containing your brand and organization. Access is verified before any business information is shown.</p><p>The authorized brand selector and setup journey are still being connected.</p><a className={styles.button} href="/tenant?mode=model">Explore the read-only model tenant</a></section> : <Connected key={query} model={model} scope={scope.toString()} view={view} params={params} link={link} />}
    </main>
  </div>;
}

function Connected({ model, scope, view, params, link }: { model: boolean; scope: string; view: string; params: URLSearchParams; link: (next: Record<string, string>) => string }) {
  const [context, retry] = useRead<TenantContext>(model ? null : '/api/tenant/context?' + scope,
    { brand: 'Northstar Services', organization: 'Model organization', access: 'read-only' });
  if (context.state !== 'ready') return <ReadState result={context} retry={retry} />;
  return <>
    <header className={styles.topbar}><div><p className={styles.eyebrow}>Brand / organization</p><strong>{context.data.brand}</strong><span> / {context.data.organization}</span></div><span className={styles.badge}>{model ? 'Model' : 'Live records'} · Read-only</span></header>
    <p className={styles.scopeNote}>Viewing organization-linked records. Location filtering and action permissions are not connected in this release.</p>
    {view === 'customers' ? <Customers key={params.get('customer') ?? params.get('offset') ?? 'list'} model={model} scope={scope} params={params} link={link} />
      : view === 'home' || view === 'work' ? <Work key={view + (params.get('offset') ?? '')} model={model} scope={scope} home={view === 'home'} params={params} link={link} />
      : <Planned view={view} />}
  </>;
}

function Customers({ model, scope, params, link }: { model: boolean; scope: string; params: URLSearchParams; link: (next: Record<string, string>) => string }) {
  const id = params.get('customer');
  return id ? <CustomerRecord model={model} scope={scope} id={id} link={link} /> : <CustomerList model={model} scope={scope} params={params} link={link} />;
}

function CustomerList({ model, scope, params, link }: { model: boolean; scope: string; params: URLSearchParams; link: (next: Record<string, string>) => string }) {
  const offset = validOffset(params.get('offset'));
  const [result, retry] = useRead<PageResult<Customer>>(model ? null : `/api/tenant/customers?${scope}&offset=${offset}`, { items: [modelCustomer.customer], hasMore: false });
  return <section><p className={styles.eyebrow}>One shared record</p><h1>Customers</h1><p className={styles.subtitle}>Customer context, work and decisions in one place.</p>
    {result.state !== 'ready' ? <ReadState result={result} retry={retry} /> : <div className={styles.panel}>
      {result.data.items.length === 0 ? <Empty>No customers found in this organization. Records without verified organization ownership are not included.</Empty>
        : <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Customer table"><table><caption>Customers in the selected organization</caption><thead><tr><th scope="col">Customer</th><th scope="col">Account</th><th scope="col">Status</th><th scope="col">Last updated</th></tr></thead><tbody>{result.data.items.map(customer => <tr key={customer.id}><td><a className={styles.recordLink} href={link({ view: 'customers', customer: customer.id })}>{customer.name}</a><small>{customer.email ?? 'No email recorded'}</small></td><td>{customer.accountName}</td><td><Status value={customer.status} /></td><td><DateLabel value={customer.updatedAt} /></td></tr>)}</tbody></table></div>}
      <Pagination offset={offset} hasMore={result.data.hasMore} href={value => link({ view: 'customers', offset: String(value) })} />
    </div>}
  </section>;
}

function CustomerRecord({ model, scope, id, link }: { model: boolean; scope: string; id: string; link: (next: Record<string, string>) => string }) {
  const [tab, setTab] = useState<typeof recordTabs[number]>('Overview');
  const [result, retry] = useRead<CustomerDetail>(model ? null : `/api/tenant/customers/${encodeURIComponent(id)}?${scope}`, modelCustomer);
  if (model && id !== modelCustomer.customer.id) return <Empty>Model customer not found. <a href={link({ view: 'customers' })}>Back to customers</a></Empty>;
  return <section><a className={styles.back} href={link({ view: 'customers' })}>← All customers</a>
    {result.state !== 'ready' ? <ReadState result={result} retry={retry} /> : <>
      <header className={styles.recordHeader}><div><p className={styles.eyebrow}>Customer record</p><h1>{result.data.customer.name}</h1><p>{result.data.customer.accountName}</p></div><Status value={result.data.customer.status} /></header>
      <nav className={styles.tabs} aria-label="Customer sections">{recordTabs.map(name => <button type="button" key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</nav>
      <section className={styles.panel} aria-label={tab}>
        {tab === 'Overview' ? <><h2>Customer details</h2><dl className={styles.details}><div><dt>Email</dt><dd>{result.data.customer.email ?? 'Not recorded'}</dd></div><div><dt>Phone</dt><dd>{result.data.customer.phone ?? 'Not recorded'}</dd></div><div><dt>Location</dt><dd>Not connected</dd></div></dl><h2>Connected cases</h2>{result.data.cases.length ? result.data.cases.map(item => <div key={item.id} className={styles.row}><strong>{item.subject}</strong><Status value={item.status} /></div>) : <Empty>No connected cases recorded.</Empty>}<Truncated show={result.data.truncated.cases} /></> : null}
        {tab === 'Activity' ? <Activity detail={result.data} /> : null}
        {tab === 'Tasks' ? <><h2>Connected tasks</h2><p className={styles.muted}>Persisted case tasks. Completing and assigning tasks is not connected here yet.</p><TaskRows rows={result.data.tasks} /><Truncated show={result.data.truncated.tasks} /></> : null}
        {tab === 'Decisions' ? <><h2>Recorded decisions</h2><p className={styles.muted}>Workflow outcomes, not proof that a communication was sent or delivered.</p>{result.data.decisions.length ? result.data.decisions.map(item => <div key={item.id + item.caseId} className={styles.row}><div><strong>{item.caseSubject}</strong><small><DateLabel value={item.decidedAt} /></small></div><Status value={item.outcome} /></div>) : <Empty>No decisions recorded for connected cases.</Empty>}<Truncated show={result.data.truncated.decisions} /></> : null}
        {tab === 'Communications' ? <Empty>Customer communication history is not connected yet. Approval, scheduling, sending and delivery will remain separate outcomes.</Empty> : null}
        {tab === 'Documents' ? <Empty>Customer documents are not connected yet. Upload, download and sharing will appear only after customer-level access is verified.</Empty> : null}
      </section>
    </>}
  </section>;
}

function Activity({ detail }: { detail: CustomerDetail }) {
  const events = [
    { id: 'customer-created', label: 'Customer created', at: detail.customer.createdAt },
    ...(detail.customer.updatedAt !== detail.customer.createdAt ? [{ id: 'customer-updated', label: 'Customer last updated', at: detail.customer.updatedAt }] : []),
    ...detail.cases.map(item => ({ id: 'case-' + item.id, label: 'Case opened · ' + item.subject, at: item.createdAt })),
    ...detail.tasks.map(item => ({ id: 'task-' + item.id, label: 'Task created · ' + item.title, at: item.createdAt })),
    ...detail.decisions.map(item => ({ id: 'decision-' + item.id + item.caseId, label: 'Decision recorded · ' + businessStatus(item.outcome), at: item.decidedAt })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return <><h2>Activity</h2><p className={styles.muted}>A summary of persisted record timestamps, not a complete audit history.</p><ol className={styles.timeline}>{events.map(item => <li key={item.id}><strong>{item.label}</strong><DateLabel value={item.at} /></li>)}</ol><Truncated show={Object.values(detail.truncated).some(Boolean)} /></>;
}

function Work({ model, scope, home, params, link }: { model: boolean; scope: string; home: boolean; params: URLSearchParams; link: (next: Record<string, string>) => string }) {
  const [tab, setTab] = useState<typeof workTabs[number]>('My tasks');
  const [now] = useState(() => Date.now());
  const offset = validOffset(params.get('offset'));
  const [result, retry] = useRead<PageResult<CustomerTask>>(model ? null : `/api/tenant/work?${scope}&offset=${offset}`, { items: modelCustomer.tasks, hasMore: false });
  const customerLink = (id: string) => link({ view: 'customers', customer: id });
  return <section><p className={styles.eyebrow}>{home ? 'Your business today' : 'One work system'}</p><h1>{home ? 'What needs you?' : 'My work'}</h1><p className={styles.subtitle}>Connected customer tasks in your selected organization.</p>
    {result.state !== 'ready' ? <ReadState result={result} retry={retry} /> : <>
      <p className={styles.scopeNote}>Showing {result.data.items.length} case-linked tasks on this page. This is not the complete business queue.</p>
      {home ? <div className={styles.homeGrid}>
        <section className={styles.panel}><h2>What needs me</h2><TaskRows rows={result.data.items.filter(task => task.isMine && task.status === 'OPEN')} customerLink={customerLink} /><a href={link({ view: 'work' })}>Open my work →</a></section>
        <section className={styles.panel}><h2>What is happening</h2><TaskRows rows={result.data.items.filter(task => task.status === 'OPEN')} customerLink={customerLink} /></section>
        <section className={styles.panel}><h2>What the system already finished</h2><Empty>Verified execution and communication outcomes are not connected to Home yet.</Empty></section>
      </div> : <><nav className={styles.tabs} aria-label="My work sections">{workTabs.map(name => <button type="button" key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</nav><section className={styles.panel} aria-label={tab}><h2>{tab}</h2>
        {tab === 'Approvals' || tab === 'Exceptions' ? <Empty>{tab} are not connected yet. No approval or retry actions are available.</Empty>
          : <TaskRows rows={result.data.items.filter(task => tab === 'My tasks' ? task.isMine && task.status === 'OPEN' : tab === 'Overdue' ? task.status === 'OPEN' && task.dueAt !== null && Date.parse(task.dueAt) < now : task.status === 'OPEN')} customerLink={customerLink} />}
      </section></>}
      <Pagination offset={offset} hasMore={result.data.hasMore} href={value => link({ view: home ? 'home' : 'work', offset: String(value) })} />
    </>}
  </section>;
}

function Planned({ view }: { view: string }) {
  const text: Record<string, string> = {
    communications: 'Sender identities, templates, recipients and schedules belong here. Customer-safe reads and governed actions are still being verified. Provider consoles do not belong in this workspace.',
    growth: 'Growth capabilities will appear only after tenant access, policy and execution outcomes are verified. AutoGTM, social publishing and inbound conversations are not available here.',
    knowledge: 'Approved knowledge and AI assistance will appear when tenant permissions and source boundaries are verified.',
    settings: 'Brand setup, enabled capabilities and permitted policy belong here. Brand selection, location ownership and role-specific homes are still being connected. Provider credentials remain platform-owned.',
  };
  return <section className={styles.panel}><p className={styles.eyebrow}>Planned · not connected</p><h1>{workspaces.find(([key]) => key === view)?.[1]}</h1><p>{text[view]}</p></section>;
}
function ReadState({ result, retry }: { result: { state: 'loading' } | { state: 'error'; message: string }; retry: () => void }) {
  return result.state === 'loading' ? <p className={styles.panel} role="status">Loading verified records…</p> : <div className={styles.error} role="alert"><p>{result.message}</p><button type="button" onClick={retry}>Try again</button><p>No model data has been substituted.</p></div>;
}
function Empty({ children }: { children: ReactNode }) { return <p className={styles.empty}>{children}</p>; }
function Status({ value }: { value: string }) { return <span className={styles.badge}>{businessStatus(value)}</span>; }
function DateLabel({ value }: { value: string }) { const time = new Date(value); return Number.isNaN(time.valueOf()) ? <span>Date unavailable</span> : <time dateTime={time.toISOString()}>{time.toISOString().slice(0, 16).replace('T', ' ')} UTC</time>; }
function TaskRows({ rows, customerLink }: { rows: CustomerTask[]; customerLink?: (id: string) => string }) {
  return rows.length ? <>{rows.map(task => <div className={styles.row} key={task.id}><div><strong>{task.title}</strong><small>{customerLink ? <a href={customerLink(task.customerId)}>{task.customerName}</a> : task.customerName}</small><small>{task.dueAt ? <>Due <DateLabel value={task.dueAt} /></> : 'No due date recorded'}</small></div><Status value={task.status} /></div>)}</> : <Empty>No matching tasks on this page.</Empty>;
}
function Truncated({ show }: { show: boolean }) { return show ? <p className={styles.scopeNote}>Showing the latest 100 records. More history exists; full-history paging is not connected yet.</p> : null; }
function validOffset(value: string | null) { return value && /^\d+$/.test(value) && Number(value) <= 10000 ? Number(value) : 0; }
function Pagination({ offset, hasMore, href }: { offset: number; hasMore: boolean; href: (offset: number) => string }) {
  return offset > 0 || hasMore ? <nav className={styles.pagination} aria-label="Record pages">{offset > 0 ? <a href={href(Math.max(0, offset - 50))}>← Previous page</a> : null}{hasMore && offset < 10000 ? <a href={href(offset + 50)}>Next page →</a> : null}</nav> : null;
}
