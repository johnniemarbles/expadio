'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../app/(workspace)/workspace.module.css';

interface RequestItem {
  requestId: string;
  status: string;
  proposedPayload: Record<string, unknown>;
  requestedBySubjectId: string;
  requestedAt: string;
  targetOrganizationId: string | null;
}

interface PlanItem {
  setupPlanId: string;
  organizationId: string;
  organizationName: string;
  organizationKind: string;
  state: string;
  completionPercent: number;
  blockingOpenRequirements: number;
}

export function BrandEnterpriseOnboarding({
  subjectId,
  selectedOrganizationName,
  initialRequests,
  initialPlans,
}: {
  subjectId: string;
  selectedOrganizationName: string;
  initialRequests: RequestItem[];
  initialPlans: PlanItem[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('BUSINESS');
  const [requests, setRequests] = useState(initialRequests);
  const [plans, setPlans] = useState(initialPlans);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function reload() {
    const response = await fetch('/api/enterprise/onboarding/requests', { cache: 'no-store' });
    const body = await response.json();
    if (response.ok) {
      setRequests(body.requests ?? []);
      setPlans(body.plans ?? []);
    }
    router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/enterprise/onboarding/requests', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'x-correlation-id': crypto.randomUUID(),
        },
        body: JSON.stringify({ name, kind }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'Request failed.');
      setName('');
      setMessage('Onboarding request submitted. A different authorized user must approve it.');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function approve(requestId: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/enterprise/onboarding/requests/${requestId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Approved from Brand Enterprise Onboarding.' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.reasonKey ?? 'Approval failed.');
      setMessage('Organization approved. Its persisted setup plan is now available below.');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Approval failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Enterprise onboarding</p>
          <h1>Onboard organization</h1>
          <p>
            Create governed organizations beneath {selectedOrganizationName}, then complete
            legal identity, accountable administration, readiness, and activation.
          </p>
        </div>
        <Link className={styles.secondaryButton} href="/enterprise">Enterprise Hub</Link>
      </section>

      {message ? <section className={styles.notice}>{message}</section> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Step 1</p>
            <h2>Request a new organization</h2>
          </div>
          <span className={styles.pill}>Governed change</span>
        </div>
        <div className={styles.panelBody}>
          <form className="learningForm" onSubmit={submit}>
            <label>
              Organization name
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              Organization kind
              <select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="BUSINESS">Business</option>
                <option value="GLOBAL_HQ">Global HQ</option>
                <option value="COUNTRY">Country</option>
                <option value="REGION">Region</option>
                <option value="CITY">City</option>
                <option value="LOCATION">Location</option>
                <option value="DEPARTMENT">Department</option>
              </select>
            </label>
            <div className="wide">
              <button className={styles.button} disabled={busy || !name.trim()} type="submit">
                {busy ? 'Submitting…' : 'Submit onboarding request'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Step 2</p>
            <h2>Approval queue</h2>
          </div>
          <span className={styles.pill}>Four-eyes required</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Organization</th><th>Kind</th><th>Status</th><th>Requester</th><th>Action</th></tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.requestId}>
                  <td><strong>{String(request.proposedPayload.name ?? 'Organization')}</strong></td>
                  <td>{String(request.proposedPayload.organizationKind ?? 'BUSINESS')}</td>
                  <td><span className={styles.pill}>{request.status}</span></td>
                  <td>{request.requestedBySubjectId === subjectId ? 'You' : request.requestedBySubjectId}</td>
                  <td>
                    {['SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(request.status)
                      ? (
                        <button
                          className={styles.secondaryButton}
                          disabled={busy || request.requestedBySubjectId === subjectId}
                          onClick={() => void approve(request.requestId)}
                          type="button"
                        >
                          {request.requestedBySubjectId === subjectId ? 'Different approver required' : 'Approve'}
                        </button>
                      )
                      : request.status}
                  </td>
                </tr>
              ))}
              {requests.length === 0 ? <tr><td className={styles.empty} colSpan={5}>No onboarding requests yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Step 3</p>
            <h2>Setup &amp; readiness</h2>
          </div>
          <span className={styles.pill}>{plans.length} active plans</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Organization</th><th>State</th><th>Progress</th><th>Blocking</th><th>Action</th></tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.setupPlanId}>
                  <td><strong>{plan.organizationName}</strong><div className={styles.metricDetail}>{plan.organizationKind}</div></td>
                  <td><span className={styles.pill}>{plan.state}</span></td>
                  <td>{plan.completionPercent.toFixed(0)}%</td>
                  <td>{plan.blockingOpenRequirements}</td>
                  <td><Link className={styles.button} href={`/enterprise/onboard/${plan.setupPlanId}`}>Continue setup</Link></td>
                </tr>
              ))}
              {plans.length === 0 ? <tr><td className={styles.empty} colSpan={5}>Approved organizations will appear here automatically.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
