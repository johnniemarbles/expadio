'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../app/(workspace)/workspace.module.css';

type Requirement = {
  setupRequirementId: string;
  requirementKey: string;
  title: string;
  description: string;
  category: string;
  blocking: boolean;
  satisfactionMode: string;
  status: string;
  evidenceRefs: readonly string[];
};
type Participant = {
  participantId: string;
  subjectId: string;
  role: 'OWNER' | 'CONTRIBUTOR' | 'REVIEWER';
  status: string;
};
type LegalEntity = {
  legalEntityId: string;
  legalName: string;
  entityType: string;
  countryCode: string;
  subdivisionCode: string | null;
  status: string;
  createdBySubjectId: string;
  verificationSource: string | null;
};
type VerifiedLegalEntity = {
  legalEntityId: string;
  legalName: string;
  entityType: string;
  jurisdictionCountryCode: string;
};
type OperatingEntity = {
  bindingId: string;
  legalEntityId: string;
  legalName: string;
  jurisdictionCountryCode: string;
};

interface SetupData {
  enterpriseId: string;
  organizationId: string;
  organizationName: string;
  organizationKind: string;
  plan: {
    setupPlanId: string;
    state: string;
    completionPercent: number;
    blockingOpenRequirements: number;
    primaryAdministratorSubjectId: string | null;
  };
  requirements: readonly Requirement[];
  participants: readonly Participant[];
  operatingEntities: readonly OperatingEntity[];
  verifiedLegalEntities: readonly VerifiedLegalEntity[];
  legalEntities: readonly LegalEntity[];
}

export function BrandEnterpriseSetupWorkspace({
  subjectId,
  initial,
}: {
  subjectId: string;
  initial: SetupData;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [participantSubject, setParticipantSubject] = useState('');
  const [participantRole, setParticipantRole] = useState<'OWNER' | 'CONTRIBUTOR' | 'REVIEWER'>('OWNER');
  const [operatingEntityId, setOperatingEntityId] = useState('');
  const [legalSearch, setLegalSearch] = useState('');
  const [searchResults, setSearchResults] = useState<LegalEntity[]>([]);
  const [legalForm, setLegalForm] = useState({
    legalName: '',
    entityType: 'CORPORATION',
    countryCode: '',
    subdivisionCode: '',
    registrationJurisdictionCode: '',
    registrationType: 'COMPANY_NUMBER',
    registrationValue: '',
  });

  const activeOwners = useMemo(
    () => data.participants.filter((participant) => participant.status === 'ACTIVE' && participant.role === 'OWNER'),
    [data.participants],
  );

  async function reload() {
    const response = await fetch(`/api/enterprise/onboarding/plans/${data.plan.setupPlanId}`, { cache: 'no-store' });
    const body = await response.json();
    if (response.ok) setData(body);
    router.refresh();
  }

  async function setupAction(payload: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/enterprise/onboarding/plans/${data.plan.setupPlanId}/actions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'x-correlation-id': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.reasonKey ?? 'Setup action failed.');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Setup action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function addParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await setupAction({ action: 'ADD_PARTICIPANT', subjectId: participantSubject, role: participantRole });
    setParticipantSubject('');
  }

  async function searchLegal() {
    if (!legalSearch.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/enterprise/onboarding/legal-entities?q=${encodeURIComponent(legalSearch)}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Legal entity search failed.');
      setSearchResults(body.matches ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Legal entity search failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitLegalEntity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/enterprise/onboarding/legal-entities', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': crypto.randomUUID(),
        },
        body: JSON.stringify(legalForm),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'Legal entity intake failed.');
      setMessage('Legal entity submitted for independent verification.');
      setLegalSearch(legalForm.registrationValue);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Legal entity intake failed.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyLegalEntity(entity: LegalEntity) {
    const evidenceRef = window.prompt('Verification evidence reference (document, registry or case reference)');
    if (!evidenceRef?.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/enterprise/onboarding/legal-entities/${entity.legalEntityId}/verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': crypto.randomUUID(),
        },
        body: JSON.stringify({ evidenceRef }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.reasonKey ?? 'Verification failed.');
      setMessage('Legal entity verified.');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  async function changeRequirement(requirement: Requirement, action: 'START' | 'SATISFY' | 'WAIVE' | 'BLOCK' | 'REOPEN') {
    let reason: string | null = null;
    let evidenceRefs: string[] = [];
    if (['WAIVE', 'BLOCK', 'REOPEN'].includes(action)) {
      reason = window.prompt('Reason for this governed change')?.trim() || null;
      if (!reason) return;
    }
    if (action === 'SATISFY' && requirement.satisfactionMode === 'EVIDENCE') {
      const evidence = window.prompt('Evidence reference(s), comma separated') ?? '';
      evidenceRefs = evidence.split(',').map((value) => value.trim()).filter(Boolean);
      if (evidenceRefs.length === 0) return;
    }
    await setupAction({
      action: 'CHANGE_REQUIREMENT',
      requirementId: requirement.setupRequirementId,
      requirementAction: action,
      reason,
      evidenceRefs,
    });
  }

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Enterprise onboarding · Setup</p>
          <h1>{data.organizationName}</h1>
          <p>
            Complete legal identity, accountable administration and readiness requirements.
            Activation remains locked until all blocking controls are satisfied.
          </p>
        </div>
        <Link className={styles.secondaryButton} href="/enterprise/onboard">Onboarding portfolio</Link>
      </section>

      {message ? <section className={styles.notice}>{message}</section> : null}

      <section className={styles.grid}>
        <article className={styles.metric}><div className={styles.metricLabel}>Setup state</div><div className={styles.metricValue}>{data.plan.state}</div><div className={styles.metricDetail}>{data.organizationKind}</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Completion</div><div className={styles.metricValue}>{data.plan.completionPercent.toFixed(0)}%</div><div className={styles.metricDetail}>Persisted readiness</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Blocking open</div><div className={styles.metricValue}>{data.plan.blockingOpenRequirements}</div><div className={styles.metricDetail}>Must reach zero</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Primary admin</div><div className={styles.metricValue}>{data.plan.primaryAdministratorSubjectId ? 'Set' : '—'}</div><div className={styles.metricDetail}>{data.plan.primaryAdministratorSubjectId ?? 'Not designated'}</div></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>Administration</p><h2>Setup participants &amp; primary administrator</h2></div></div>
        <div className={styles.panelBody}>
          <form className="learningForm" onSubmit={addParticipant}>
            <label>Clerk subject ID<input value={participantSubject} onChange={(event) => setParticipantSubject(event.target.value)} required /></label>
            <label>Role<select value={participantRole} onChange={(event) => setParticipantRole(event.target.value as typeof participantRole)}><option>OWNER</option><option>CONTRIBUTOR</option><option>REVIEWER</option></select></label>
            <div className="wide"><button className={styles.button} disabled={busy} type="submit">Add participant</button></div>
          </form>
          <div className={styles.tableWrap} style={{ marginTop: 18 }}>
            <table className={styles.table}>
              <thead><tr><th>Subject</th><th>Role</th><th>Status</th><th>Primary admin</th></tr></thead>
              <tbody>
                {data.participants.map((participant) => (
                  <tr key={participant.participantId}>
                    <td>{participant.subjectId === subjectId ? 'You' : participant.subjectId}</td>
                    <td>{participant.role}</td>
                    <td>{participant.status}</td>
                    <td>
                      {participant.role === 'OWNER' && participant.status === 'ACTIVE'
                        ? <button className={styles.secondaryButton} disabled={busy || data.plan.primaryAdministratorSubjectId === participant.subjectId} type="button" onClick={() => void setupAction({ action: 'DESIGNATE_PRIMARY_ADMIN', subjectId: participant.subjectId })}>{data.plan.primaryAdministratorSubjectId === participant.subjectId ? 'Primary' : 'Designate'}</button>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {activeOwners.length === 0 ? <p className={styles.notice}>At least one active OWNER is required before a primary administrator can be designated.</p> : null}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>Legal identity</p><h2>Search Before Create</h2></div><span className={styles.pill}>Independent verification</span></div>
        <div className={styles.panelBody}>
          <div className="learningForm">
            <label className="wide">Search name or registration ID<input value={legalSearch} onChange={(event) => setLegalSearch(event.target.value)} /></label>
            <div className="wide"><button className={styles.secondaryButton} disabled={busy || !legalSearch.trim()} type="button" onClick={() => void searchLegal()}>Search enterprise legal entities</button></div>
          </div>
          {searchResults.length > 0 ? (
            <div className={styles.tableWrap} style={{ marginTop: 18 }}>
              <table className={styles.table}>
                <thead><tr><th>Name</th><th>Type</th><th>Jurisdiction</th><th>Status</th><th>Registration</th></tr></thead>
                <tbody>{searchResults.map((entity: any) => <tr key={entity.legalEntityId}><td>{entity.legalName}</td><td>{entity.entityType}</td><td>{entity.countryCode}</td><td>{entity.status}</td><td>{entity.registrationValue ?? '—'}</td></tr>)}</tbody>
              </table>
            </div>
          ) : null}

          <h3 style={{ marginTop: 24 }}>Submit new legal entity</h3>
          <form className="learningForm" onSubmit={submitLegalEntity}>
            <label>Legal name<input value={legalForm.legalName} onChange={(event) => setLegalForm({ ...legalForm, legalName: event.target.value })} required /></label>
            <label>Entity type<select value={legalForm.entityType} onChange={(event) => setLegalForm({ ...legalForm, entityType: event.target.value })}><option>CORPORATION</option><option>LLC</option><option>PARTNERSHIP</option><option>SOLE_PROPRIETORSHIP</option><option>JOINT_VENTURE</option><option>OTHER</option></select></label>
            <label>Country code<input maxLength={2} value={legalForm.countryCode} onChange={(event) => setLegalForm({ ...legalForm, countryCode: event.target.value.toUpperCase() })} required /></label>
            <label>Subdivision code<input value={legalForm.subdivisionCode} onChange={(event) => setLegalForm({ ...legalForm, subdivisionCode: event.target.value })} /></label>
            <label>Registration jurisdiction<input value={legalForm.registrationJurisdictionCode} onChange={(event) => setLegalForm({ ...legalForm, registrationJurisdictionCode: event.target.value.toUpperCase() })} required /></label>
            <label>Registration type<input value={legalForm.registrationType} onChange={(event) => setLegalForm({ ...legalForm, registrationType: event.target.value.toUpperCase() })} required /></label>
            <label className="wide">Registration value<input value={legalForm.registrationValue} onChange={(event) => setLegalForm({ ...legalForm, registrationValue: event.target.value })} required /></label>
            <div className="wide"><button className={styles.button} disabled={busy} type="submit">Submit for verification</button></div>
          </form>

          <div className={styles.tableWrap} style={{ marginTop: 18 }}>
            <table className={styles.table}>
              <thead><tr><th>Legal entity</th><th>Status</th><th>Creator</th><th>Action</th></tr></thead>
              <tbody>
                {data.legalEntities.map((entity) => (
                  <tr key={entity.legalEntityId}>
                    <td><strong>{entity.legalName}</strong><div className={styles.metricDetail}>{entity.entityType} · {entity.countryCode}</div></td>
                    <td><span className={styles.pill}>{entity.status}</span></td>
                    <td>{entity.createdBySubjectId === subjectId ? 'You' : entity.createdBySubjectId}</td>
                    <td>
                      {entity.status === 'VERIFICATION_PENDING'
                        ? <button className={styles.secondaryButton} disabled={busy || entity.createdBySubjectId === subjectId} type="button" onClick={() => void verifyLegalEntity(entity)}>{entity.createdBySubjectId === subjectId ? 'Different verifier required' : 'Verify with evidence'}</button>
                        : entity.verificationSource ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>Operating entity</p><h2>Bind verified legal operator</h2></div></div>
        <div className={styles.panelBody}>
          {data.operatingEntities.length > 0 ? (
            <div className={styles.notice}>Assigned: {data.operatingEntities.map((entity) => entity.legalName).join(', ')}</div>
          ) : (
            <div className="learningForm">
              <label className="wide">Verified legal entity<select value={operatingEntityId} onChange={(event) => setOperatingEntityId(event.target.value)}><option value="">Select verified entity</option>{data.verifiedLegalEntities.map((entity) => <option key={entity.legalEntityId} value={entity.legalEntityId}>{entity.legalName} · {entity.jurisdictionCountryCode}</option>)}</select></label>
              <div className="wide"><button className={styles.button} disabled={busy || !operatingEntityId} type="button" onClick={() => void setupAction({ action: 'ASSIGN_OPERATING_ENTITY', legalEntityId: operatingEntityId })}>Assign operating entity</button></div>
            </div>
          )}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>Readiness</p><h2>Requirements</h2></div><span className={styles.pill}>{data.plan.blockingOpenRequirements} blocking open</span></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Requirement</th><th>Category</th><th>Mode</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {data.requirements.map((requirement) => (
                <tr key={requirement.setupRequirementId}>
                  <td><strong>{requirement.title}</strong><div className={styles.metricDetail}>{requirement.description}</div></td>
                  <td>{requirement.category}</td>
                  <td>{requirement.satisfactionMode}</td>
                  <td><span className={styles.pill}>{requirement.status}</span></td>
                  <td>
                    {requirement.satisfactionMode === 'AUTOMATED'
                      ? 'Evaluated automatically'
                      : (
                        <div className={styles.appActions}>
                          {requirement.status === 'PENDING' ? <button className={styles.secondaryButton} disabled={busy} type="button" onClick={() => void changeRequirement(requirement, 'START')}>Start</button> : null}
                          {['PENDING', 'IN_PROGRESS', 'BLOCKED'].includes(requirement.status) ? <button className={styles.secondaryButton} disabled={busy} type="button" onClick={() => void changeRequirement(requirement, 'SATISFY')}>Satisfy</button> : null}
                          {['SATISFIED', 'WAIVED', 'BLOCKED'].includes(requirement.status) ? <button className={styles.secondaryButton} disabled={busy} type="button" onClick={() => void changeRequirement(requirement, 'REOPEN')}>Reopen</button> : null}
                        </div>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.plan.state === 'READY_FOR_ACTIVATION' ? (
        <section className={styles.notice}>
          <strong>Ready for parent activation.</strong> Return to the Enterprise Hub to perform the final governed activation.
        </section>
      ) : null}
    </>
  );
}
