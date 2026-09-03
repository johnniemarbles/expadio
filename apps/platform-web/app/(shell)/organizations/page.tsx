import React from 'react';
import styles from '../page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState, EmptyState, StatusBadge } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import type { RouteSearchParams } from '../../../lib/request-context';
import {
  ReadinessPortfolio,
  type ReadinessPortfolioItem,
} from './ReadinessPortfolio';
import {
  CommercialNetwork,
  type CommercialNetworkData,
} from './CommercialNetwork';

interface OrganizationRow {
  organization_id: string;
  name: string;
  status: string;
  members?: number;
  created_at: string;
}

interface ReadinessPortfolioResponse {
  parentOrganizationId: string;
  items: ReadinessPortfolioItem[];
}

function organizationTone(status: string): 'positive' | 'warning' | 'danger' | 'neutral' {
  const normalized = status.toUpperCase();
  if (normalized === 'ACTIVE') return 'positive';
  if (normalized === 'SUSPENDED' || normalized === 'PENDING') return 'warning';
  if (normalized === 'DISABLED' || normalized === 'DEACTIVATED' || normalized === 'FAILED') return 'danger';
  return 'neutral';
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: RouteSearchParams | Promise<RouteSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const query = new URLSearchParams();
  const account = resolvedSearchParams.account;
  const org = resolvedSearchParams.org;
  if (typeof account === 'string') query.set('account', account);
  if (typeof org === 'string') query.set('org', org);
  const suffix = query.size > 0 ? '?' + query.toString() : '';

  const [orgs, readiness, commercial] = await Promise.all([
    fetchApi<OrganizationRow[]>('/api/organizations/list' + suffix),
    fetchApi<ReadinessPortfolioResponse>('/api/enterprise/setup/portfolio' + suffix),
    fetchApi<CommercialNetworkData>('/api/enterprise/commercial' + suffix),
  ]);

  if (isDenied(orgs)) return <DeniedState result={orgs} />;
  const readinessItems = isDenied(readiness) ? [] : readiness.items;
  const commercialData: CommercialNetworkData = isDenied(commercial)
    ? {
        enterpriseId: null,
        organizations: [],
        legalEntities: [],
        territories: [],
        agreements: [],
        appointments: [],
        jurisdictions: [],
      }
    : commercial;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Enterprise structure</p>
          <h1 id="page-title">Organizations</h1>
          <p>
            Manage the governed organization hierarchy, monitor descendant onboarding,
            and activate organizations only after their blocking readiness gates are satisfied.
          </p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="readiness-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Setup &amp; readiness</p>
            <h2 id="readiness-title">Descendant onboarding portfolio</h2>
          </div>
          <span className={styles.countBadge}>{readinessItems.length}</span>
        </div>
        <ReadinessPortfolio items={readinessItems} />
      </section>

      <section className={styles.panel} aria-labelledby="commercial-title" style={{ marginBottom: 16 }}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Enterprise Hub</p>
            <h2 id="commercial-title">Commercial network &amp; jurisdictions</h2>
          </div>
          <span className={styles.countBadge}>
            {commercialData.appointments.length + commercialData.jurisdictions.length}
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <CommercialNetwork data={commercialData} suffix={suffix} />
        </div>
      </section>

      <section
        className={[styles.panel, styles.activityPanel].join(' ')}
        style={{ marginTop: 16 }}
        aria-labelledby="orgs-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Hierarchy</p>
            <h2 id="orgs-title">Accessible organizations</h2>
          </div>
          <span className={styles.countBadge}>{orgs.length}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Organization Name</th>
                <th>Status</th>
                <th>Members</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((organization) => (
                <tr key={organization.organization_id}>
                  <td>
                    <strong>{organization.name}</strong>
                    <br />
                    <span className={styles.code}>{organization.organization_id}</span>
                  </td>
                  <td><StatusBadge tone={organizationTone(organization.status)}>{organization.status}</StatusBadge></td>
                  <td>{organization.members ?? 0}</td>
                  <td className={styles.muted}>
                    {new Date(organization.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orgs.length === 0 && (
            <EmptyState
              title="No organizations"
              description="No organizations are currently accessible from this workspace."
            />
          )}
        </div>
      </section>
    </>
  );
}
