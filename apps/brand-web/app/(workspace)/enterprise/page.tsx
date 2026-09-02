import Link from 'next/link';
import { resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import { loadBrandEnterpriseView } from '../../../lib/enterprise-data';
import { BrandActivateOrganizationButton } from '../../../components/BrandActivateOrganizationButton';
import styles from '../workspace.module.css';

export const dynamic = 'force-dynamic';

function title(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function BrandEnterprisePage() {
  const context = await resolveBrandContext();
  const enterprise = await withBrandTransaction(
    context,
    (client) => loadBrandEnterpriseView(client, context),
  );

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Enterprise control plane</p>
          <h1>{enterprise.enterpriseName}</h1>
          <p>
            Govern the selected Brand workspace within its enterprise hierarchy. Tenant plan
            entitlements remain separate from enterprise structure, legal entities, readiness,
            commercial authority, and jurisdiction permission.
          </p>
        </div>
        <div className={styles.appActions}>
          <Link className={styles.button} href="/enterprise/onboard/profile">
            {enterprise.enterpriseConfigurationState === 'CONFIGURED' ? 'Configure enterprise' : 'Onboard enterprise'}
          </Link>
          <Link className={styles.secondaryButton} href="/enterprise/onboard">Onboard organization</Link>
          <Link className={styles.secondaryButton} href="/">Back to dashboard</Link>
        </div>
      </section>

      {enterprise.enterpriseConfigurationState === 'BOOTSTRAPPED' ? (
        <section className={styles.notice}>
          <strong>Enterprise profile onboarding is incomplete.</strong> The tenant has a bootstrap enterprise profile, but enterprise identity, operating mode, and root authority have not yet completed governed configuration.
        </section>
      ) : null}

      <section className={styles.grid}>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Organizations</div>
          <div className={styles.metricValue}>{enterprise.counts.organizations}</div>
          <div className={styles.metricDetail}>{enterprise.counts.activeOrganizations} active in visible hierarchy</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Ready to activate</div>
          <div className={styles.metricValue}>{enterprise.counts.readyForActivation}</div>
          <div className={styles.metricDetail}>{enterprise.counts.configuringOrganizations} still configuring</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Verified legal entities</div>
          <div className={styles.metricValue}>{enterprise.counts.verifiedLegalEntities}</div>
          <div className={styles.metricDetail}>{enterprise.counts.legalEntities} visible operating entities</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Active jurisdictions</div>
          <div className={styles.metricValue}>{enterprise.counts.activeJurisdictions}</div>
          <div className={styles.metricDetail}>
            {enterprise.counts.activeAppointments} appointments · {enterprise.counts.activeAgreements} agreements
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Structure</p>
            <h2>Organization hierarchy &amp; setup readiness</h2>
          </div>
          <span className={styles.pill}>{title(enterprise.enterpriseMode)} · {title(enterprise.enterpriseConfigurationState)}</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Organization</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Setup</th>
                <th>Progress</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {enterprise.organizations.map((organization) => (
                <tr key={organization.organizationId}>
                  <td>
                    <strong>{'↳ '.repeat(Math.min(organization.depth, 4))}{organization.name}</strong>
                    <div className={styles.metricDetail}>{organization.organizationId}</div>
                  </td>
                  <td>{title(organization.organizationKind)}</td>
                  <td><span className={styles.pill}>{title(organization.status)}</span></td>
                  <td>{organization.setupState ? title(organization.setupState) : '—'}</td>
                  <td>
                    {organization.completionPercent === null ? '—' : `${organization.completionPercent}%`}
                    {organization.blockingOpenRequirements !== null
                      ? <div className={styles.metricDetail}>{organization.blockingOpenRequirements} blocking open</div>
                      : null}
                  </td>
                  <td>
                    {organization.setupPlanId && organization.organizationId !== enterprise.selectedOrganizationId
                      ? organization.setupState === 'READY_FOR_ACTIVATION'
                        ? (
                          <BrandActivateOrganizationButton
                            setupPlanId={organization.setupPlanId}
                            organizationName={organization.name}
                          />
                        )
                        : (
                          <Link className={styles.secondaryButton} href={'/enterprise/onboard/' + organization.setupPlanId}>
                            Continue setup
                          </Link>
                        )
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Legal structure</p>
            <h2>Legal entities</h2>
          </div>
          <span className={styles.pill}>{enterprise.counts.verifiedLegalEntities} verified</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Legal entity</th>
                <th>Type</th>
                <th>Jurisdiction</th>
                <th>Status</th>
                <th>Organization roles</th>
              </tr>
            </thead>
            <tbody>
              {enterprise.legalEntities.map((entity) => (
                <tr key={entity.legalEntityId}>
                  <td><strong>{entity.legalName}</strong></td>
                  <td>{title(entity.entityType)}</td>
                  <td>{entity.countryCode}{entity.subdivisionCode ? ` · ${entity.subdivisionCode}` : ''}</td>
                  <td><span className={styles.pill}>{title(entity.status)}</span></td>
                  <td>
                    {entity.organizationBindings.length === 0
                      ? '—'
                      : entity.organizationBindings.map((binding) => (
                          <div key={`${binding.organizationId}:${binding.bindingRole}`}>
                            {binding.organizationName} · {title(binding.bindingRole)}
                          </div>
                        ))}
                  </td>
                </tr>
              ))}
              {enterprise.legalEntities.length === 0 ? (
                <tr><td colSpan={5} className={styles.empty}>No legal entities are bound to this visible organization hierarchy.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Commercial network</p>
            <h2>Agreements &amp; appointments</h2>
          </div>
          <span className={styles.pill}>{enterprise.commercial.activeAppointments} active appointments</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Appointment</th>
                <th>Beneficiary</th>
                <th>Rights</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {enterprise.commercial.appointments.map((appointment) => (
                <tr key={appointment.appointmentId}>
                  <td>{title(appointment.kind)}</td>
                  <td>{appointment.beneficiaryOrganizationName}</td>
                  <td>{appointment.rights.join(', ')}</td>
                  <td><span className={styles.pill}>{title(appointment.state)}</span></td>
                </tr>
              ))}
              {enterprise.commercial.appointments.length === 0 ? (
                <tr><td colSpan={4} className={styles.empty}>No commercial appointments are visible from this hierarchy.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Permission to operate</p>
            <h2>Jurisdiction activations</h2>
          </div>
          <span className={styles.pill}>{enterprise.commercial.activeJurisdictions} active</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Organization</th>
                <th>Territory</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {enterprise.commercial.jurisdictions.map((jurisdiction) => (
                <tr key={jurisdiction.jurisdictionActivationId}>
                  <td>{jurisdiction.organizationName}</td>
                  <td>{jurisdiction.territoryName}</td>
                  <td><span className={styles.pill}>{title(jurisdiction.state)}</span></td>
                </tr>
              ))}
              {enterprise.commercial.jurisdictions.length === 0 ? (
                <tr><td colSpan={3} className={styles.empty}>No jurisdiction activation records are visible from this hierarchy.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
