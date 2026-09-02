'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import styles from '../app/(workspace)/workspace.module.css';

type Profile = {
  enterpriseId: string;
  name: string;
  mode: 'SIMPLE' | 'GLOBAL';
  status: string;
  configurationState: 'BOOTSTRAPPED' | 'CONFIGURED';
  rootOrganizationId: string | null;
  configuredAt: string | null;
  configuredBySubjectId: string | null;
};

type ProfileRequest = {
  requestId: string;
  status: string;
  proposedName: string;
  proposedMode: 'SIMPLE' | 'GLOBAL';
  proposedRootOrganizationId: string;
  requestedBySubjectId: string;
  decidedBySubjectId: string | null;
  decisionReason: string | null;
};

type ResponseData = {
  profile: Profile;
  selectedOrganization: {
    organizationId: string;
    name: string;
    status: string;
    parentOrganizationId: string | null;
    isRootCandidate: boolean;
  };
  rootOrganizationName: string | null;
  requests: ProfileRequest[];
};

export function BrandEnterpriseProfileOnboarding({
  subjectId,
}: {
  subjectId: string;
}) {
  const [data, setData] = useState<ResponseData | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'SIMPLE' | 'GLOBAL'>('SIMPLE');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/enterprise/onboarding/profile', {
      cache: 'no-store',
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Unable to load enterprise profile.');
    setData(body);
    setName(body.profile.name);
    setMode(body.profile.mode);
  }

  useEffect(() => {
    void load().catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to load enterprise profile.');
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/enterprise/onboarding/profile', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'x-correlation-id': crypto.randomUUID(),
        },
        body: JSON.stringify({ name, mode }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'Configuration request failed.');
      setMessage('Enterprise profile configuration submitted. A different authorized user must approve it.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Configuration request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function approve(requestId: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(
        `/api/enterprise/onboarding/profile/requests/${requestId}/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            reason: 'Approved from Brand enterprise profile onboarding.',
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.reasonKey ?? 'Approval failed.');
      setMessage('Enterprise profile configured.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Approval failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <section className={styles.panel}>
        <div className={styles.panelBody}>
          <p>{message || 'Loading enterprise profile…'}</p>
        </div>
      </section>
    );
  }

  const configured = data.profile.configurationState === 'CONFIGURED';

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Enterprise onboarding · Profile</p>
          <h1>{configured ? 'Configure enterprise' : 'Onboard enterprise'}</h1>
          <p>
            Convert the tenant bootstrap profile into an explicitly governed enterprise:
            establish its identity, operating mode, and primary root authority before
            expanding the organization hierarchy.
          </p>
        </div>
        <Link className={styles.secondaryButton} href="/enterprise/onboard">
          Organization onboarding
        </Link>
      </section>

      {message ? <section className={styles.notice}>{message}</section> : null}

      <section className={styles.grid}>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Configuration</div>
          <div className={styles.metricValue}>{configured ? 'Configured' : 'Bootstrap'}</div>
          <div className={styles.metricDetail}>
            {data.profile.configuredAt
              ? `Configured ${new Date(data.profile.configuredAt).toLocaleDateString()}`
              : 'Governed configuration still required'}
          </div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Operating mode</div>
          <div className={styles.metricValue}>{data.profile.mode}</div>
          <div className={styles.metricDetail}>
            {data.profile.mode === 'GLOBAL'
              ? 'Multi-country / hierarchical enterprise'
              : 'Simple enterprise structure'}
          </div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Root authority</div>
          <div className={styles.metricValue}>{data.rootOrganizationName ?? '—'}</div>
          <div className={styles.metricDetail}>
            {data.profile.rootOrganizationId ?? 'No root authority assigned'}
          </div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Selected workspace</div>
          <div className={styles.metricValue}>{data.selectedOrganization.name}</div>
          <div className={styles.metricDetail}>
            {data.selectedOrganization.isRootCandidate ? 'Eligible root authority' : 'Not a top-level authority'}
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Governed configuration</p>
            <h2>Enterprise identity &amp; operating model</h2>
          </div>
          <span className={styles.pill}>
            {data.selectedOrganization.isRootCandidate ? 'Root workspace' : 'Root workspace required'}
          </span>
        </div>
        <div className={styles.panelBody}>
          {!data.selectedOrganization.isRootCandidate ? (
            <div className={styles.notice}>
              Switch to an active top-level organization workspace to submit or approve
              enterprise-wide profile changes.
            </div>
          ) : null}
          <form className="learningForm" onSubmit={submit}>
            <label className="wide">
              Enterprise name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                disabled={!data.selectedOrganization.isRootCandidate}
              />
            </label>
            <label className="wide">
              Operating mode
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as 'SIMPLE' | 'GLOBAL')}
                disabled={!data.selectedOrganization.isRootCandidate}
              >
                <option value="SIMPLE">SIMPLE — one primary operating structure</option>
                <option value="GLOBAL">GLOBAL — multi-country / multi-level hierarchy</option>
              </select>
            </label>
            <div className="wide">
              <button
                className={styles.button}
                disabled={busy || !data.selectedOrganization.isRootCandidate || !name.trim()}
                type="submit"
              >
                {configured ? 'Submit profile change' : 'Submit enterprise configuration'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Four-eyes governance</p>
            <h2>Configuration approval queue</h2>
          </div>
          <span className={styles.pill}>{data.requests.length} requests</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Proposed enterprise</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Requester</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.requests.map((request) => (
                <tr key={request.requestId}>
                  <td>
                    <strong>{request.proposedName}</strong>
                    <div className={styles.metricDetail}>{request.proposedRootOrganizationId}</div>
                  </td>
                  <td>{request.proposedMode}</td>
                  <td><span className={styles.pill}>{request.status}</span></td>
                  <td>{request.requestedBySubjectId === subjectId ? 'You' : request.requestedBySubjectId}</td>
                  <td>
                    {['SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(request.status) ? (
                      <button
                        className={styles.secondaryButton}
                        disabled={busy || request.requestedBySubjectId === subjectId}
                        type="button"
                        onClick={() => void approve(request.requestId)}
                      >
                        {request.requestedBySubjectId === subjectId
                          ? 'Different approver required'
                          : 'Approve'}
                      </button>
                    ) : request.status}
                  </td>
                </tr>
              ))}
              {data.requests.length === 0 ? (
                <tr><td className={styles.empty} colSpan={5}>No enterprise profile configuration requests.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {configured ? (
        <section className={styles.notice}>
          <strong>Enterprise profile configured.</strong> Continue with organization,
          legal-entity and readiness onboarding from the organization onboarding workspace.
        </section>
      ) : null}
    </>
  );
}
