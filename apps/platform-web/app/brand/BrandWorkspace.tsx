'use client';

import { useEffect, useState } from 'react';
import styles from './brand.module.css';

type Customer = { id: string; name: string; status: string; accountName: string };
type PageResult = { items: Customer[]; hasMore: boolean };
type Load = { state: 'loading' } | { state: 'empty-scope' } | { state: 'error'; message: string } | { state: 'ready'; data: PageResult };
type JourneyStep = { step: string; state: string; executor: string | null };
type JourneyLoad =
  | { state: 'loading' }
  | { state: 'empty-scope' }
  | { state: 'error'; message: string }
  | { state: 'ready'; correlation: string; steps: JourneyStep[]; mutationsEnabled: boolean; autoSend: boolean };

const SURFACES = [
  ['home', 'Home'],
  ['work', 'My work'],
  ['customers', 'Customers'],
  ['communications', 'Communications'],
  ['growth', 'Growth'],
  ['knowledge', 'Knowledge'],
  ['settings', 'Settings'],
] as const;

export default function BrandWorkspace({ query, nav }: { query: string; nav: readonly string[] }) {
  const params = new URLSearchParams(query);
  const view = SURFACES.some(([key]) => key === (params.get('view') ?? '')) ? (params.get('view') ?? 'customers') : 'customers';
  const scoped = params.has('tenant') && params.has('brand') && params.has('location');
  function href(next: Record<string, string>) {
    const output = new URLSearchParams();
    for (const key of ['tenant', 'brand', 'location']) {
      const value = params.get(key);
      if (value) output.set(key, value);
    }
    for (const [key, value] of Object.entries(next)) output.set(key, value);
    return '/brand?' + output.toString();
  }
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Brand navigation">
        <p className={styles.mark}>EXPADIO<small>Brand</small></p>
        <nav>
          {nav.map((label) => {
            const key = SURFACES.find(([, name]) => name === label)?.[0] ?? 'customers';
            return (
              <a key={label} href={href({ view: key })} aria-current={view === key ? 'page' : undefined}>
                {label}
              </a>
            );
          })}
        </nav>
        <p className={styles.note}>Same-origin Brand chrome. Not the Platform sidebar.</p>
      </aside>
      <main className={styles.main}>
        <p className={styles.fixture}>Brand fallback on /brand · Reads go through /brand/api/* · No mutations</p>
        {view === 'customers' ? <Customers scoped={scoped} query={query} /> : null}
        {view === 'home' || view === 'work' || view === 'communications' ? (
          <Journey scoped={scoped} query={query} view={view} />
        ) : null}
        {view === 'growth' || view === 'knowledge' || view === 'settings' ? <Planned view={view} /> : null}
      </main>
    </div>
  );
}

function Customers({ scoped, query }: { scoped: boolean; query: string }) {
  const [result, setResult] = useState<Load>(scoped ? { state: 'loading' } : { state: 'empty-scope' });
  useEffect(() => {
    if (!scoped) return;
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    const url = `/brand/api/customers?tenant=${encodeURIComponent(params.get('tenant') ?? '')}&brand=${encodeURIComponent(params.get('brand') ?? '')}&location=${encodeURIComponent(params.get('location') ?? '')}`;
    void fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { message?: string; items?: Customer[]; hasMore?: boolean };
        if (!response.ok) throw new Error(body.message ?? 'Unable to load customers.');
        setResult({ state: 'ready', data: { items: body.items ?? [], hasMore: Boolean(body.hasMore) } });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ state: 'error', message: error instanceof Error ? error.message : 'Unable to load customers.' });
        }
      });
    return () => controller.abort();
  }, [scoped, query]);
  return (
    <section>
      <p className={styles.eyebrow}>One shared record</p>
      <h1>Customers</h1>
      {result.state === 'empty-scope' ? (
        <p>Open this workspace with tenant, brand and location product codes. Account and organization UUIDs are not accepted here.</p>
      ) : null}
      {result.state === 'loading' ? <p role="status">Loading verified records…</p> : null}
      {result.state === 'error' ? (
        <p role="alert">{result.message}</p>
      ) : null}
      {result.state === 'ready' && result.data.items.length === 0 ? (
        <p>No customers found for this verified Brand scope.</p>
      ) : null}
      {result.state === 'ready' && result.data.items.length > 0 ? (
        <ul>
          {result.data.items.map((customer) => (
            <li key={customer.id}>
              <strong>{customer.name}</strong> · {customer.accountName} · {customer.status}
            </li>
          ))}
        </ul>
      ) : null}
      <p className={styles.note}>
        CS-104 journey stays observation-only: case → SCHEDULE → CREATE_TASK → COMMUNICATE → delivery.
        A finished task is not a send.
      </p>
    </section>
  );
}

function Journey({ scoped, query, view }: { scoped: boolean; query: string; view: string }) {
  const [result, setResult] = useState<JourneyLoad>(scoped ? { state: 'loading' } : { state: 'empty-scope' });
  useEffect(() => {
    if (!scoped) return;
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    const url = `/brand/api/journey?tenant=${encodeURIComponent(params.get('tenant') ?? '')}&brand=${encodeURIComponent(params.get('brand') ?? '')}&location=${encodeURIComponent(params.get('location') ?? '')}&correlation=CS-104`;
    void fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          message?: string;
          correlation?: string;
          steps?: JourneyStep[];
          mutationsEnabled?: boolean;
          autoSend?: boolean;
        };
        if (!response.ok) throw new Error(body.message ?? 'Unable to load journey observation.');
        setResult({
          state: 'ready',
          correlation: body.correlation ?? 'CS-104',
          steps: body.steps ?? [],
          mutationsEnabled: Boolean(body.mutationsEnabled),
          autoSend: Boolean(body.autoSend),
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ state: 'error', message: error instanceof Error ? error.message : 'Unable to load journey observation.' });
        }
      });
    return () => controller.abort();
  }, [scoped, query]);
  const title = view === 'home' ? 'Home' : view === 'work' ? 'My work' : 'Communications';
  const visibleSteps =
    view === 'communications'
      ? result.state === 'ready'
        ? result.steps.filter((step) => step.step === 'COMMUNICATE' || step.step === 'DELIVERY')
        : []
      : result.state === 'ready'
        ? result.steps
        : [];
  return (
    <section>
      <p className={styles.eyebrow}>Observation only · frozen executors</p>
      <h1>{title}</h1>
      {result.state === 'empty-scope' ? (
        <p>Open this workspace with tenant, brand and location to observe CS-104.</p>
      ) : null}
      {result.state === 'loading' ? <p role="status">Loading CS-104 observation…</p> : null}
      {result.state === 'error' ? <p role="alert">{result.message}</p> : null}
      {result.state === 'ready' ? (
        <>
          <p className={styles.note}>
            {result.correlation} · mutations {result.mutationsEnabled ? 'on' : 'off'} · auto-send {result.autoSend ? 'on' : 'off'}
          </p>
          <ol className={styles.journey}>
            {visibleSteps.map((step) => (
              <li key={step.step}>
                <strong>{step.step}</strong>
                <span>{step.state}</span>
                <small>{step.executor ?? 'no executor'}</small>
              </li>
            ))}
          </ol>
          <p className={styles.note}>
            {view === 'communications'
              ? 'Delivered is only shown when the provider reports DELIVERED. A succeeded send is not delivery.'
              : 'No step is observed until a frozen executor reports it. Schedule and task completion are not delivery.'}
          </p>
        </>
      ) : null}
    </section>
  );
}

function Planned({ view }: { view: string }) {
  const label = SURFACES.find(([key]) => key === view)?.[1] ?? view;
  return (
    <section>
      <p className={styles.eyebrow}>Planned · not connected</p>
      <h1>{label}</h1>
      <p>This Brand surface is reserved. Growth, Knowledge and Settings stay dark. Communications observes CS-104 only.</p>
    </section>
  );
}
