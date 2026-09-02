'use client';

import { FormEvent, useMemo, useState } from 'react';
import styles from './enterprise.module.css';

type Tab =
  | 'overview'
  | 'structure'
  | 'perspectives'
  | 'legal'
  | 'commercial'
  | 'jurisdictions'
  | 'readiness'
  | 'approvals';

export interface EnterpriseHubData {
  scope: {
    tenantId: string;
    enterpriseId: string;
    governingOrganizationId: string;
  };
  organizations: Array<{
    organization_id: string;
    name: string;
    organization_kind: string;
    status: string;
    parent_organization_id: string | null;
  }>;
  legalEntities: Array<{
    legal_entity_id: string;
    legal_name: string;
    entity_type: string;
    jurisdiction_country_code: string;
    status: string;
    organization_ids: string[];
  }>;
  perspectives: Array<{
    perspective:
      | 'GOVERNANCE'
      | 'OWNERSHIP_LEGAL'
      | 'COMMERCIAL'
      | 'TERRITORY_JURISDICTION'
      | 'OPERATIONAL';
    nodes: Array<{
      entityType: string;
      entityId: string;
      displayName: string | null;
      edgePath: unknown[];
      pathDepth: number;
      effectiveFrom: string;
      provenanceSource: string;
      confidence: number;
    }>;
  }>;
  setupReadiness: Array<{
    organizationId: string;
    state: string;
    completionPercent: number;
    blockingOpenRequirements: number;
  }>;
  pendingChangeRequests: Array<{
    enterprise_change_request_id: string;
    operation: string;
    status: string;
    target_organization_id: string | null;
    target_legal_entity_id: string | null;
    requested_at: string;
  }>;
  portfolio: {
    territories: Array<{
      territoryId: string;
      parentTerritoryId: string | null;
      territoryKey: string;
      name: string;
      territoryKind: string;
      countryCode: string | null;
      subdivisionCode: string | null;
      localityName: string | null;
      status: string;
    }>;
    agreements: Array<{
      agreementId: string;
      agreementNumber: string | null;
      title: string;
      agreementKind: string;
      grantorLegalEntityId: string;
      granteeLegalEntityId: string;
      sponsoringOrganizationId: string;
      state: string;
      effectiveFrom: string | null;
      effectiveUntil: string | null;
      executionEvidenceRefs: string[];
    }>;
    appointments: Array<{
      appointmentId: string;
      agreementId: string;
      grantorOrganizationId: string;
      beneficiaryOrganizationId: string;
      beneficiaryLegalEntityId: string;
      appointmentKind: string;
      rightsProfileKey: string;
      requestedRightTypes: string[];
      state: string;
      workflowInstanceId: string | null;
      workflowRightsGrantId: string | null;
      territories: Array<{
        territoryId: string;
        name: string;
        exclusive: boolean;
      }>;
    }>;
    jurisdictions: Array<{
      jurisdictionActivationId: string;
      organizationId: string;
      appointmentId: string;
      territoryId: string;
      workflowActivationId: string | null;
      state: string;
      evidenceRefs: string[];
      verification: null | {
        state: string;
        verifiedAt: string;
      };
    }>;
  };
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'structure', label: 'Structure' },
  { key: 'perspectives', label: 'Perspectives' },
  { key: 'legal', label: 'Legal Entities' },
  { key: 'commercial', label: 'Commercial Network' },
  { key: 'jurisdictions', label: 'Jurisdictions' },
  { key: 'readiness', label: 'Setup & Readiness' },
  { key: 'approvals', label: 'Approvals' },
];

const RIGHTS: Record<string, string[]> = {
  MASTER_FRANCHISEE: ['OPERATE','SELL','DISTRIBUTE','WHOLESALE','RETAIL','SUB_APPOINT'],
  FRANCHISEE: ['OPERATE','SELL','RETAIL'],
  DISTRIBUTOR: ['DISTRIBUTE','SELL'],
  WHOLESALER: ['WHOLESALE','SELL'],
  RETAILER: ['RETAIL','SELL'],
  AFFILIATE: ['REFER'],
  BROKER: ['BROKER'],
  LICENSEE: ['LICENSE','OPERATE'],
  OPERATOR: ['OPERATE','SELL','RETAIL','SERVICE','MANAGE'],
  AGENT: ['SELL','REFER'],
  MANAGEMENT_PROVIDER: ['MANAGE','SERVICE'],
  SERVICE_PROVIDER: ['SERVICE'],
  JV_PARTNER: ['OPERATE','MANAGE','SERVICE'],
};

function stateTone(state: string) {
  if (['ACTIVE','VERIFIED','APPROVED'].includes(state)) return styles.goodState;
  if (['REJECTED','REVOKED','FAILED','TERMINATED'].includes(state)) return styles.badState;
  return styles.pendingState;
}

function readable(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function EnterpriseHub({
  data,
  suffix,
}: {
  data: EnterpriseHubData;
  suffix: string;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [beneficiaryOrg, setBeneficiaryOrg] = useState('');
  const [appointmentKind, setAppointmentKind] = useState('DISTRIBUTOR');
  const [selectedRights, setSelectedRights] = useState<string[]>(RIGHTS.DISTRIBUTOR ?? []);
  const [selectedTerritories, setSelectedTerritories] = useState<string[]>([]);
  const [jurisdictionEvidence, setJurisdictionEvidence] = useState<Record<string,string>>({});
  const [agreementEvidence, setAgreementEvidence] = useState<Record<string,string>>({});

  const organizationById = useMemo(
    () => new Map(data.organizations.map((item) => [item.organization_id, item])),
    [data.organizations],
  );
  const legalById = useMemo(
    () => new Map(data.legalEntities.map((item) => [item.legal_entity_id, item])),
    [data.legalEntities],
  );
  const territoryById = useMemo(
    () => new Map(data.portfolio.territories.map((item) => [item.territoryId, item])),
    [data.portfolio.territories],
  );
  const activeAgreements = data.portfolio.agreements.filter((item) => item.state === 'ACTIVE');
  const beneficiaryOrganizations = data.organizations.filter(
    (item) =>
      item.organization_id !== data.scope.governingOrganizationId
      && item.status === 'ACTIVE',
  );
  const beneficiaryEntities = data.legalEntities.filter(
    (item) => beneficiaryOrg !== '' && item.organization_ids.includes(beneficiaryOrg),
  );

  async function mutate(
    key: string,
    path: string,
    body: Record<string, unknown>,
    success: string,
    idempotent = false,
  ) {
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch(path + suffix, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': crypto.randomUUID(),
          ...(idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}),
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.denied === true) {
        throw new Error(payload?.message ?? payload?.reasonKey ?? 'The governed operation was rejected.');
      }
      setNotice({ kind: 'ok', text: success });
      window.location.reload();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'The governed operation failed.',
      });
    } finally {
      setBusy(null);
    }
  }

  function setKind(kind: string) {
    setAppointmentKind(kind);
    setSelectedRights([...(RIGHTS[kind] ?? [])]);
  }

  async function createTerritory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(
      'territory:create',
      '/api/enterprise/commercial/territories',
      {
        territoryKey: form.get('territoryKey'),
        name: form.get('name'),
        territoryKind: form.get('territoryKind'),
        countryCode: form.get('countryCode'),
        subdivisionCode: form.get('subdivisionCode'),
        localityName: form.get('localityName'),
      },
      'Territory created.',
    );
  }

  async function createAgreement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(
      'agreement:create',
      '/api/enterprise/commercial/agreements',
      {
        agreementNumber: form.get('agreementNumber'),
        title: form.get('title'),
        agreementKind: form.get('agreementKind'),
        grantorLegalEntityId: form.get('grantorLegalEntityId'),
        granteeLegalEntityId: form.get('granteeLegalEntityId'),
        governingLawCountryCode: form.get('governingLawCountryCode'),
      },
      'Commercial agreement drafted.',
      true,
    );
  }

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(
      'appointment:create',
      '/api/enterprise/commercial/appointments',
      {
        agreementId: form.get('agreementId'),
        beneficiaryOrganizationId: beneficiaryOrg,
        beneficiaryLegalEntityId: form.get('beneficiaryLegalEntityId'),
        appointmentKind,
        requestedRightTypes: selectedRights,
        territoryIds: selectedTerritories,
        exclusiveTerritoryIds:
          form.get('exclusive') === 'on' ? selectedTerritories : [],
      },
      'Appointment submitted to commercial review.',
      true,
    );
  }

  const activeJurisdictions = data.portfolio.jurisdictions.filter((item) => item.state === 'ACTIVE');
  const openReadiness = data.setupReadiness.filter((item) => item.state !== 'ACTIVATED');

  return (
    <div className={styles.hub}>
      <nav className={styles.tabs} aria-label="Enterprise Hub sections">
        {TABS.map((item) => (
          <button
            type="button"
            key={item.key}
            className={tab === item.key ? styles.tabActive : ''}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {notice && (
        <div className={notice.kind === 'error' ? styles.errorNotice : styles.successNotice}>
          {notice.text}
        </div>
      )}

      {tab === 'overview' && (
        <div className={styles.stack}>
          <section className={styles.metrics}>
            <article><strong>{data.organizations.length}</strong><span>Organizations in scope</span></article>
            <article><strong>{data.legalEntities.length}</strong><span>Visible legal entities</span></article>
            <article><strong>{data.portfolio.appointments.filter((item) => item.state === 'ACTIVE').length}</strong><span>Active appointments</span></article>
            <article><strong>{activeJurisdictions.length}</strong><span>Active jurisdictions</span></article>
          </section>
          <section className={styles.twoColumn}>
            <article className={styles.panel}>
              <header><div><span>Authority chain</span><h2>Commercial network health</h2></div></header>
              <div className={styles.panelBody}>
                <div className={styles.summaryRow}><span>Active commercial agreements</span><strong>{activeAgreements.length}</strong></div>
                <div className={styles.summaryRow}><span>Appointments awaiting rights</span><strong>{data.portfolio.appointments.filter((item) => item.state === 'APPROVED').length}</strong></div>
                <div className={styles.summaryRow}><span>Jurisdictions in activation review</span><strong>{data.portfolio.jurisdictions.filter((item) => item.state === 'ACTIVATION_REVIEW').length}</strong></div>
                <div className={styles.summaryRow}><span>Pending enterprise changes</span><strong>{data.pendingChangeRequests.length}</strong></div>
              </div>
            </article>
            <article className={styles.panel}>
              <header><div><span>Readiness</span><h2>Organization activation</h2></div></header>
              <div className={styles.panelBody}>
                <div className={styles.summaryRow}><span>Open setup journeys</span><strong>{openReadiness.length}</strong></div>
                <div className={styles.summaryRow}><span>Blocking requirements</span><strong>{openReadiness.reduce((sum, item) => sum + item.blockingOpenRequirements, 0)}</strong></div>
                <p className={styles.help}>
                  Organization activation and jurisdiction activation are independent gates:
                  an active organization still needs commercial rights and verified jurisdiction permission.
                </p>
              </div>
            </article>
          </section>
        </div>
      )}

      {tab === 'perspectives' && (
        <div className={styles.stack}>
          <section className={styles.panel}>
            <header>
              <div>
                <span>Five-perspective graph</span>
                <h2>Enterprise relationship projections</h2>
              </div>
              <small>
                Read-only, effective-dated views rooted at the currently authorized governing organization.
              </small>
            </header>
            <div className={styles.perspectiveGrid}>
              {data.perspectives.map((projection) => (
                <article className={styles.perspectiveCard} key={projection.perspective}>
                  <header>
                    <div>
                      <span>{readable(projection.perspective)}</span>
                      <strong>{projection.nodes.length}</strong>
                    </div>
                    <small>reachable entities</small>
                  </header>
                  <div className={styles.perspectiveNodes}>
                    {projection.nodes.map((node) => (
                      <div
                        className={styles.perspectiveNode}
                        key={projection.perspective + ':' + node.entityType + ':' + node.entityId}
                      >
                        <div>
                          <strong>{node.displayName ?? node.entityId}</strong>
                          <small>
                            {readable(node.entityType)}
                            {' · '}
                            {node.pathDepth} edge{node.pathDepth === 1 ? '' : 's'}
                          </small>
                        </div>
                        <div className={styles.perspectiveEvidence}>
                          <span>{readable(node.provenanceSource)}</span>
                          <span>{Math.round(node.confidence * 100)}% confidence</span>
                        </div>
                      </div>
                    ))}
                    {projection.nodes.length === 0 ? (
                      <p className={styles.perspectiveEmpty}>
                        No governed relationships are currently reachable in this perspective.
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            <div className={styles.perspectiveFootnote}>
              Unclassified legacy relationships are excluded. Each result uses the shortest explainable
              governed path from the active organization and preserves effective-date provenance.
            </div>
          </section>
        </div>
      )}

      {tab === 'structure' && (
        <section className={styles.panel}>
          <header><div><span>Operational hierarchy</span><h2>Organizations</h2></div></header>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Organization</th><th>Kind</th><th>Status</th><th>Parent</th></tr></thead>
              <tbody>{data.organizations.map((organization) => (
                <tr key={organization.organization_id}>
                  <td><strong>{organization.name}</strong><small>{organization.organization_id}</small></td>
                  <td>{readable(organization.organization_kind)}</td>
                  <td><span className={stateTone(organization.status)}>{readable(organization.status)}</span></td>
                  <td>{organization.parent_organization_id ? organizationById.get(organization.parent_organization_id)?.name ?? organization.parent_organization_id : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'legal' && (
        <section className={styles.panel}>
          <header><div><span>Corporate identity</span><h2>Legal entities</h2></div><small>Verified entities are eligible for commercial authority.</small></header>
          <div className={styles.cards}>
            {data.legalEntities.map((entity) => (
              <article key={entity.legal_entity_id}>
                <span>{entity.jurisdiction_country_code}</span>
                <h3>{entity.legal_name}</h3>
                <p>{readable(entity.entity_type)}</p>
                <footer>
                  <b className={stateTone(entity.status)}>{readable(entity.status)}</b>
                  <small>{entity.organization_ids.length} organization binding(s)</small>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === 'commercial' && (
        <div className={styles.stack}>
          <section className={styles.panel}>
            <header><div><span>Geographic authority</span><h2>Territory catalog</h2></div><small>Structured geography now; geometry can be attached later without changing right IDs.</small></header>
            <form className={styles.formGrid} onSubmit={createTerritory}>
              <label>Stable key<input name="territoryKey" required placeholder="ca.on" /></label>
              <label>Name<input name="name" required placeholder="Ontario" /></label>
              <label>Kind<select name="territoryKind" defaultValue="COUNTRY"><option>GLOBAL</option><option>COUNTRY</option><option>SUBDIVISION</option><option>LOCALITY</option><option>CUSTOM</option></select></label>
              <label>Country code<input name="countryCode" maxLength={2} placeholder="CA" /></label>
              <label>Subdivision<input name="subdivisionCode" placeholder="ON" /></label>
              <label>Locality<input name="localityName" placeholder="Toronto" /></label>
              <button disabled={busy !== null}>Create territory</button>
            </form>
            <div className={styles.chips}>
              {data.portfolio.territories.map((territory) => (
                <span key={territory.territoryId}>
                  <strong>{territory.name}</strong>
                  <small>{readable(territory.territoryKind)}{territory.countryCode ? ' · ' + territory.countryCode : ''}</small>
                </span>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <header><div><span>Legal authority</span><h2>Commercial agreements</h2></div><small>Approval and execution activation are separate.</small></header>
            <form className={styles.formGrid} onSubmit={createAgreement}>
              <label>Title<input name="title" required placeholder="Canada Master Franchise" /></label>
              <label>Agreement number<input name="agreementNumber" placeholder="MF-CA-001" /></label>
              <label>Kind<select name="agreementKind" defaultValue="MASTER_FRANCHISE"><option>FRANCHISE</option><option>MASTER_FRANCHISE</option><option>DISTRIBUTION</option><option>WHOLESALE</option><option>RETAIL</option><option>AFFILIATE</option><option>BROKER</option><option>LICENSE</option><option>AGENCY</option><option>MANAGEMENT</option><option>SERVICE</option><option>JOINT_VENTURE</option><option>OTHER</option></select></label>
              <label>Grantor<select name="grantorLegalEntityId" required defaultValue=""><option value="" disabled>Select verified entity</option>{data.legalEntities.map((entity) => <option value={entity.legal_entity_id} key={entity.legal_entity_id}>{entity.legal_name}</option>)}</select></label>
              <label>Grantee<select name="granteeLegalEntityId" required defaultValue=""><option value="" disabled>Select verified entity</option>{data.legalEntities.map((entity) => <option value={entity.legal_entity_id} key={entity.legal_entity_id}>{entity.legal_name}</option>)}</select></label>
              <label>Governing country<input name="governingLawCountryCode" maxLength={2} placeholder="CA" /></label>
              <button disabled={busy !== null || data.legalEntities.length < 2}>Create draft</button>
            </form>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Agreement</th><th>Parties</th><th>State</th><th>Governed action</th></tr></thead>
                <tbody>{data.portfolio.agreements.map((agreement) => (
                  <tr key={agreement.agreementId}>
                    <td><strong>{agreement.title}</strong><small>{agreement.agreementNumber ?? agreement.agreementId}</small></td>
                    <td>{legalById.get(agreement.grantorLegalEntityId)?.legal_name ?? 'Grantor'} → {legalById.get(agreement.granteeLegalEntityId)?.legal_name ?? 'Grantee'}</td>
                    <td><span className={stateTone(agreement.state)}>{readable(agreement.state)}</span></td>
                    <td>
                      {agreement.state === 'DRAFT' && (
                        <button
                          disabled={busy !== null}
                          onClick={() => void mutate(
                            'agreement:approve:' + agreement.agreementId,
                            '/api/enterprise/commercial/agreements/' + agreement.agreementId + '/approve',
                            { reason: 'Commercial terms reviewed.' },
                            'Agreement approved. Execution evidence is still required for activation.',
                          )}
                        >Approve</button>
                      )}
                      {agreement.state === 'APPROVED' && (
                        <div className={styles.inlineAction}>
                          <input
                            value={agreementEvidence[agreement.agreementId] ?? ''}
                            onChange={(event) => setAgreementEvidence((current) => ({ ...current, [agreement.agreementId]: event.target.value }))}
                            placeholder="execution evidence ref"
                          />
                          <button
                            disabled={busy !== null || !(agreementEvidence[agreement.agreementId] ?? '').trim()}
                            onClick={() => void mutate(
                              'agreement:activate:' + agreement.agreementId,
                              '/api/enterprise/commercial/agreements/' + agreement.agreementId + '/activate',
                              { evidenceRefs: [agreementEvidence[agreement.agreementId]!.trim()] },
                              'Agreement activated from execution evidence.',
                            )}
                          >Activate</button>
                        </div>
                      )}
                      {agreement.state === 'ACTIVE' && <span className={styles.goodState}>Executable authority</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <header><div><span>Appointments & rights</span><h2>Commercial network</h2></div><small>Decision → rights grant → active appointment.</small></header>
            <form className={styles.formGrid} onSubmit={createAppointment}>
              <label>Active agreement<select name="agreementId" required defaultValue=""><option value="" disabled>Select active agreement</option>{activeAgreements.map((agreement) => <option value={agreement.agreementId} key={agreement.agreementId}>{agreement.title}</option>)}</select></label>
              <label>Beneficiary organization<select required value={beneficiaryOrg} onChange={(event) => setBeneficiaryOrg(event.target.value)}><option value="">Select descendant</option>{beneficiaryOrganizations.map((organization) => <option value={organization.organization_id} key={organization.organization_id}>{organization.name}</option>)}</select></label>
              <label>Operating legal entity<select name="beneficiaryLegalEntityId" required defaultValue=""><option value="" disabled>Select bound verified entity</option>{beneficiaryEntities.map((entity) => <option value={entity.legal_entity_id} key={entity.legal_entity_id}>{entity.legal_name}</option>)}</select></label>
              <label>Appointment<select value={appointmentKind} onChange={(event) => setKind(event.target.value)}>{Object.keys(RIGHTS).map((kind) => <option key={kind}>{kind}</option>)}</select></label>
              <label className={styles.wide}>Rights<div className={styles.checkGrid}>{(RIGHTS[appointmentKind] ?? []).map((right) => <label key={right}><input type="checkbox" checked={selectedRights.includes(right)} onChange={(event) => setSelectedRights((current) => event.target.checked ? [...current, right] : current.filter((item) => item !== right))} />{right}</label>)}</div></label>
              <label className={styles.wide}>Territories<select multiple value={selectedTerritories} onChange={(event) => setSelectedTerritories(Array.from(event.target.selectedOptions, (option) => option.value))} size={Math.min(5, Math.max(2, data.portfolio.territories.length))}>{data.portfolio.territories.filter((territory) => territory.status === 'ACTIVE').map((territory) => <option value={territory.territoryId} key={territory.territoryId}>{territory.name}</option>)}</select></label>
              <label className={styles.checkRow}><input type="checkbox" name="exclusive" />Exclusive in selected territories</label>
              <button disabled={busy !== null || activeAgreements.length === 0 || !beneficiaryOrg || selectedRights.length === 0 || selectedTerritories.length === 0}>Submit for review</button>
            </form>
            <div className={styles.cards}>
              {data.portfolio.appointments.map((appointment) => (
                <article key={appointment.appointmentId}>
                  <span>{readable(appointment.appointmentKind)}</span>
                  <h3>{organizationById.get(appointment.beneficiaryOrganizationId)?.name ?? appointment.beneficiaryOrganizationId}</h3>
                  <p>{appointment.requestedRightTypes.join(', ')}</p>
                  <p>{appointment.territories.map((territory) => territory.name + (territory.exclusive ? ' · exclusive' : '')).join(', ')}</p>
                  <footer>
                    <b className={stateTone(appointment.state)}>{readable(appointment.state)}</b>
                    {appointment.state === 'UNDER_REVIEW' && (
                      <>
                        <button disabled={busy !== null} onClick={() => void mutate('appointment:approve:' + appointment.appointmentId, '/api/enterprise/commercial/appointments/' + appointment.appointmentId + '/decision', { outcome: 'APPROVE' }, 'Appointment approved; rights are still pending.')}>Approve</button>
                        <button className={styles.secondaryButton} disabled={busy !== null} onClick={() => void mutate('appointment:reject:' + appointment.appointmentId, '/api/enterprise/commercial/appointments/' + appointment.appointmentId + '/decision', { outcome: 'REJECT' }, 'Appointment rejected.')}>Reject</button>
                      </>
                    )}
                    {appointment.state === 'APPROVED' && (
                      <button disabled={busy !== null} onClick={() => void mutate('appointment:rights:' + appointment.appointmentId, '/api/enterprise/commercial/appointments/' + appointment.appointmentId + '/rights', {}, 'Immutable rights issued and appointment activated.')}>Issue rights</button>
                    )}
                    {appointment.state === 'ACTIVE' && <span className={styles.goodState}>Rights active</span>}
                  </footer>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === 'jurisdictions' && (
        <div className={styles.stack}>
          <section className={styles.panel}>
            <header><div><span>Permission to operate</span><h2>Jurisdiction activation</h2></div><small>Rights do not themselves authorize operations in a jurisdiction.</small></header>
            <div className={styles.cards}>
              {data.portfolio.appointments.filter((item) => item.state === 'ACTIVE').map((appointment) => (
                <article key={appointment.appointmentId}>
                  <span>{readable(appointment.appointmentKind)}</span>
                  <h3>{organizationById.get(appointment.beneficiaryOrganizationId)?.name ?? appointment.beneficiaryOrganizationId}</h3>
                  <p>Available appointed territories</p>
                  <footer>
                    {appointment.territories.map((territory) => {
                      const existing = data.portfolio.jurisdictions.find(
                        (item) =>
                          item.appointmentId === appointment.appointmentId
                          && item.territoryId === territory.territoryId,
                      );
                      return existing ? (
                        <span className={stateTone(existing.state)} key={territory.territoryId}>
                          {territory.name}: {readable(existing.state)}
                        </span>
                      ) : (
                        <button
                          key={territory.territoryId}
                          disabled={busy !== null}
                          onClick={() => void mutate(
                            'jurisdiction:start:' + appointment.appointmentId + ':' + territory.territoryId,
                            '/api/enterprise/commercial/jurisdictions',
                            { appointmentId: appointment.appointmentId, territoryId: territory.territoryId },
                            'Jurisdiction activation review started.',
                            true,
                          )}
                        >Start {territory.name} review</button>
                      );
                    })}
                  </footer>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <header><div><span>Activation controls</span><h2>Jurisdiction reviews</h2></div><small>Verification, approval, and activation are separate evidence-bearing operations.</small></header>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Organization / territory</th><th>Verification</th><th>State</th><th>Next governed action</th></tr></thead>
                <tbody>{data.portfolio.jurisdictions.map((item) => {
                  const evidence = jurisdictionEvidence[item.jurisdictionActivationId] ?? '';
                  return (
                    <tr key={item.jurisdictionActivationId}>
                      <td>
                        <strong>{organizationById.get(item.organizationId)?.name ?? item.organizationId}</strong>
                        <small>{territoryById.get(item.territoryId)?.name ?? item.territoryId}</small>
                      </td>
                      <td>{item.verification ? <span className={stateTone(item.verification.state)}>{readable(item.verification.state)}</span> : 'Not verified'}</td>
                      <td><span className={stateTone(item.state)}>{readable(item.state)}</span></td>
                      <td>
                        {item.state === 'ACTIVATION_REVIEW' && item.verification?.state !== 'VERIFIED' && (
                          <div className={styles.inlineAction}>
                            <input value={evidence} onChange={(event) => setJurisdictionEvidence((current) => ({ ...current, [item.jurisdictionActivationId]: event.target.value }))} placeholder="verification evidence ref" />
                            <button disabled={busy !== null || !evidence.trim()} onClick={() => {
                              const ref = evidence.trim();
                              const assessments = [
                                ['AGREEMENT','SATISFIED','Commercial agreement verified.'],
                                ['RIGHTS','SATISFIED','Territory rights verified.'],
                                ['ACCESS','NOT_APPLICABLE','No provisioning access required by this activation blueprint.'],
                                ['COMPLIANCE','SATISFIED','Jurisdiction compliance verified.'],
                                ['OPERATIONAL_READINESS','SATISFIED','Operational readiness verified.'],
                              ].map(([dimension,outcome,reason]) => ({ dimension, outcome, reason, evidenceRefs: [ref] }));
                              void mutate(
                                'jurisdiction:verify:' + item.jurisdictionActivationId,
                                '/api/enterprise/commercial/jurisdictions/' + item.jurisdictionActivationId + '/verify',
                                { assessments, reason: 'Jurisdiction controls independently verified.', evidenceRefs: [ref] },
                                'Verification recorded. A separate approver must now approve activation.',
                              );
                            }}>Record verification</button>
                          </div>
                        )}
                        {item.state === 'ACTIVATION_REVIEW' && item.verification?.state === 'VERIFIED' && (
                          <button disabled={busy !== null} onClick={() => void mutate('jurisdiction:approve:' + item.jurisdictionActivationId, '/api/enterprise/commercial/jurisdictions/' + item.jurisdictionActivationId + '/approve', { reason: 'Verified jurisdiction activation approved.' }, 'Jurisdiction approved; final activation remains explicit.')}>Approve</button>
                        )}
                        {item.state === 'APPROVED' && (
                          <div className={styles.inlineAction}>
                            <input value={evidence} onChange={(event) => setJurisdictionEvidence((current) => ({ ...current, [item.jurisdictionActivationId]: event.target.value }))} placeholder="activation evidence ref" />
                            <button disabled={busy !== null || !evidence.trim()} onClick={() => void mutate('jurisdiction:activate:' + item.jurisdictionActivationId, '/api/enterprise/commercial/jurisdictions/' + item.jurisdictionActivationId + '/activate', { evidenceRefs: [evidence.trim()] }, 'Jurisdiction activated.')}>Activate</button>
                          </div>
                        )}
                        {item.state === 'ACTIVE' && <span className={styles.goodState}>Permission active</span>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'readiness' && (
        <section className={styles.panel}>
          <header><div><span>Setup journeys</span><h2>Organization readiness</h2></div></header>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Organization</th><th>State</th><th>Progress</th><th>Blocking</th></tr></thead>
              <tbody>{data.setupReadiness.map((item) => (
                <tr key={item.organizationId}>
                  <td><strong>{organizationById.get(item.organizationId)?.name ?? item.organizationId}</strong></td>
                  <td><span className={stateTone(item.state)}>{readable(item.state)}</span></td>
                  <td>{item.completionPercent.toFixed(0)}%</td>
                  <td>{item.blockingOpenRequirements}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'approvals' && (
        <section className={styles.panel}>
          <header><div><span>Governed change</span><h2>Pending enterprise changes</h2></div></header>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Operation</th><th>Status</th><th>Target</th><th>Requested</th></tr></thead>
              <tbody>{data.pendingChangeRequests.map((item) => (
                <tr key={item.enterprise_change_request_id}>
                  <td><strong>{readable(item.operation)}</strong></td>
                  <td><span className={stateTone(item.status)}>{readable(item.status)}</span></td>
                  <td>{item.target_organization_id ? organizationById.get(item.target_organization_id)?.name ?? item.target_organization_id : item.target_legal_entity_id ?? '—'}</td>
                  <td>{new Date(item.requested_at).toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
