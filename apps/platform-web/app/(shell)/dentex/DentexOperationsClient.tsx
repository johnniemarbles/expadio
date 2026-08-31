'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { CrmAccount, CrmContact } from '@expadio/party';
import { apiError } from '../../../lib/api-error';
import styles from './dentex-operations.module.css';

type PatientRow = CrmContact & { accountName: string | null };
type Tab = 'patients' | 'practices';

async function json(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export default function DentexOperationsClient({
  initialPractices,
  initialPatients,
}: {
  initialPractices: CrmAccount[];
  initialPatients: PatientRow[];
}) {
  const [tab, setTab] = useState<Tab>('patients');
  const [practices, setPractices] = useState(initialPractices);
  const [patients, setPatients] = useState(initialPatients);
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [showPracticeForm, setShowPracticeForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activePatients = patients.filter((patient) => patient.status !== 'ARCHIVED');
  const activePractices = practices.filter((practice) => practice.status !== 'ARCHIVED');

  const linkedPatients = useMemo(
    () => activePatients.filter((patient) => patient.accountId !== null).length,
    [activePatients],
  );

  async function reload() {
    const [practiceResponse, patientResponse] = await Promise.all([
      fetch('/api/crm/accounts', { cache: 'no-store' }),
      fetch('/api/crm/contacts', { cache: 'no-store' }),
    ]);
    if (practiceResponse.ok) {
      const body = await json(practiceResponse);
      if (Array.isArray(body)) setPractices(body);
    }
    if (patientResponse.ok) {
      const body = await json(patientResponse);
      if (Array.isArray(body)) setPatients(body);
    }
  }

  async function createPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: form.get('fullName'),
          email: form.get('email'),
          phone: form.get('phone'),
          accountId: form.get('practiceId') || null,
          title: 'Patient',
        }),
      });
      const body = await json(response);
      if (!response.ok) throw new Error(apiError(body, 'Could not create the Patient.'));
      await reload();
      setShowPatientForm(false);
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the Patient.');
    } finally {
      setBusy(false);
    }
  }

  async function createPractice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/crm/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          domain: form.get('domain'),
          industry: 'Dental',
          lifecycleStage: 'CUSTOMER',
        }),
      });
      const body = await json(response);
      if (!response.ok) throw new Error(apiError(body, 'Could not create the Practice.'));
      await reload();
      setShowPracticeForm(false);
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the Practice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>DENTEX · Clinical operations</div>
          <h1>Patient & Practice Operations</h1>
          <p>
            Dental operating views over EXPADIO&apos;s governed CRM authorities.
            Patient and Practice data remains canonical CRM data under tenant RLS.
          </p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.secondaryButton} href="/crm?vertical=dentex">Open CRM engine</a>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => tab === 'patients' ? setShowPatientForm(true) : setShowPracticeForm(true)}
          >
            + New {tab === 'patients' ? 'Patient' : 'Practice'}
          </button>
        </div>
      </header>

      {error ? <div role="alert" className={styles.error}>{error}</div> : null}

      <section className={styles.metrics} aria-label="DENTEX patient and practice summary">
        <Metric label="Active Patients" value={activePatients.length.toString()} />
        <Metric label="Practices" value={activePractices.length.toString()} />
        <Metric label="Patients linked to Practice" value={linkedPatients.toString()} />
        <Metric
          label="Unlinked Patients"
          value={(activePatients.length - linkedPatients).toString()}
          warning={activePatients.length - linkedPatients > 0}
        />
      </section>

      <nav className={styles.tabs} aria-label="DENTEX operations">
        <button
          type="button"
          className={tab === 'patients' ? styles.tabActive : styles.tab}
          onClick={() => setTab('patients')}
        >
          Patients
        </button>
        <button
          type="button"
          className={tab === 'practices' ? styles.tabActive : styles.tab}
          onClick={() => setTab('practices')}
        >
          Practices
        </button>
      </nav>

      {tab === 'patients' ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Patients</h2>
              <p>Canonical contacts presented in DENTEX clinical language.</p>
            </div>
            <button type="button" className={styles.textButton} onClick={() => setShowPatientForm(true)}>
              Add Patient
            </button>
          </div>
          {activePatients.length === 0 ? (
            <EmptyState title="No Patients yet" body="Create a Patient and optionally attach them to a Practice." />
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr><th>Patient</th><th>Practice</th><th>Email</th><th>Phone</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {activePatients.map((patient) => (
                    <tr key={patient.contactId}>
                      <td><strong>{patient.fullName}</strong><small>{patient.contactId}</small></td>
                      <td>{patient.accountName ?? <span className={styles.warningText}>Not linked</span>}</td>
                      <td>{patient.email ?? '—'}</td>
                      <td>{patient.phone ?? '—'}</td>
                      <td><Status value={patient.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Practices</h2>
              <p>Canonical accounts presented as dental Practices.</p>
            </div>
            <button type="button" className={styles.textButton} onClick={() => setShowPracticeForm(true)}>
              Add Practice
            </button>
          </div>
          {activePractices.length === 0 ? (
            <EmptyState title="No Practices yet" body="Create the first Practice before linking Patients and Treatments." />
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr><th>Practice</th><th>Domain</th><th>Patients</th><th>Lifecycle</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {activePractices.map((practice) => (
                    <tr key={practice.accountId}>
                      <td><strong>{practice.name}</strong><small>{practice.accountId}</small></td>
                      <td>{practice.domain ?? '—'}</td>
                      <td>{activePatients.filter((patient) => patient.accountId === practice.accountId).length}</td>
                      <td>{practice.lifecycleStage}</td>
                      <td><Status value={practice.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showPatientForm ? (
        <Modal title="Create Patient" onClose={() => !busy && setShowPatientForm(false)}>
          <form className={styles.form} onSubmit={createPatient}>
            <label>Full name<input name="fullName" required maxLength={200} autoFocus /></label>
            <div className={styles.formGrid}>
              <label>Email<input name="email" type="email" /></label>
              <label>Phone<input name="phone" /></label>
            </div>
            <label>
              Practice
              <select name="practiceId" defaultValue="">
                <option value="">Not linked yet</option>
                {activePractices.map((practice) => (
                  <option key={practice.accountId} value={practice.accountId}>{practice.name}</option>
                ))}
              </select>
            </label>
            <p className={styles.formHint}>A Patient must have an email, phone, or linked Practice.</p>
            <div className={styles.formActions}>
              <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setShowPatientForm(false)}>Cancel</button>
              <button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Creating…' : 'Create Patient'}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {showPracticeForm ? (
        <Modal title="Create Practice" onClose={() => !busy && setShowPracticeForm(false)}>
          <form className={styles.form} onSubmit={createPractice}>
            <label>Practice name<input name="name" required maxLength={200} autoFocus /></label>
            <label>Domain<input name="domain" placeholder="exampledental.com" /></label>
            <p className={styles.formHint}>Practices are persisted as CRM Accounts with Dental industry and CUSTOMER lifecycle.</p>
            <div className={styles.formActions}>
              <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setShowPracticeForm(false)}>Cancel</button>
              <button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Creating…' : 'Create Practice'}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className={styles.metric}><span>{label}</span><strong className={warning ? styles.metricWarning : ''}>{value}</strong></div>;
}

function Status({ value }: { value: string }) {
  return <span className={styles.status}>{value}</span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className={styles.empty}><strong>{title}</strong><p>{body}</p></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={onClose}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </section>
    </div>
  );
}
