import { listTenantProductModules } from '@expadio/postgres-runtime/product-module';
import Link from 'next/link';
import { parseProductModuleShellDescriptor } from '@expadio/ui';
import { ModuleLauncher } from '../../components/ModuleLauncher';
import { resolveBrandContext, withBrandTransaction } from '../../lib/brand-context';
import { loadBrandEnterpriseView } from '../../lib/enterprise-data';
import styles from './workspace.module.css';

export const dynamic = 'force-dynamic';


function label(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function BrandHome() {
  const context = await resolveBrandContext();
  const state = await withBrandTransaction(context, async (client) => ({
    modules: await listTenantProductModules(client, context.tenantId),
    enterprise: await loadBrandEnterpriseView(client, context),
  }));
  const modules = state.modules;
  const enterprise = state.enterprise;
  const active = modules.filter((module) => module.availability === 'ACTIVE').length;
  const ready = modules.filter((module) => module.availability === 'READY_TO_ACTIVATE').length;
  const locked = modules.filter((module) => module.availability === 'LOCKED_BY_PLAN').length;

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Brand workspace</p>
          <h1>All Apps</h1>
          <p>Open the capabilities available to {context.tenantName}. App state comes from Platform entitlement and installation records; this dashboard cannot grant itself a plan entitlement.</p>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Enterprise control plane</p>
            <h2>{enterprise.enterpriseName}</h2>
          </div>
          <Link className={styles.secondaryButton} href="/enterprise">Open Enterprise Hub</Link>
        </div>
        <div className={styles.panelBody}>
          <div className={styles.grid}>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Visible organizations</div>
              <div className={styles.metricValue}>{enterprise.counts.organizations}</div>
              <div className={styles.metricDetail}>{enterprise.counts.readyForActivation} ready to activate</div>
            </article>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Verified legal entities</div>
              <div className={styles.metricValue}>{enterprise.counts.verifiedLegalEntities}</div>
              <div className={styles.metricDetail}>Bound to this hierarchy</div>
            </article>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Active appointments</div>
              <div className={styles.metricValue}>{enterprise.counts.activeAppointments}</div>
              <div className={styles.metricDetail}>{enterprise.counts.activeAgreements} active agreements</div>
            </article>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Active jurisdictions</div>
              <div className={styles.metricValue}>{enterprise.counts.activeJurisdictions}</div>
              <div className={styles.metricDetail}>Verified permission to operate</div>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.appStats} style={{ marginTop: 18 }}>
        <article className={styles.metric}><div className={styles.metricLabel}>Active apps</div><div className={styles.metricValue}>{active}</div><div className={styles.metricDetail}>Ready to use now</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Ready to activate</div><div className={styles.metricValue}>{ready}</div><div className={styles.metricDetail}>Entitled but not installed</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Plan locked</div><div className={styles.metricValue}>{locked}</div><div className={styles.metricDetail}>Requires Platform commercial entitlement</div></article>
      </section>

      <section className={styles.appGrid}>
        {modules.map((module) => {
          const descriptor = parseProductModuleShellDescriptor({
            moduleKey: module.moduleKey,
            displayName: module.displayName,
            description: module.description,
            manifest: module.manifest,
          });
          return <article className={styles.appCard} key={module.moduleKey}>
            <div className={styles.appCardHead}>
              <div><h2>{module.displayName}</h2><p>{module.description}</p></div>
              <span className={styles.pill}>{label(module.availability)}</span>
            </div>
            <div className={styles.appMeta}>
              <span className={styles.metaChip}>Entitlement: {module.entitlement.active ? 'Active' : 'None'}</span>
              <span className={styles.metaChip}>Install: {module.installationState ?? 'Not installed'}</span>
              {module.entitlement.sourceType ? <span className={styles.metaChip}>{module.entitlement.sourceType}</span> : null}
            </div>
            <div className={styles.appActions}>
              <ModuleLauncher
                moduleKey={module.moduleKey}
                availability={module.availability}
                route={descriptor?.baseRoute ?? null}
              />
            </div>
          </article>;
        })}
      </section>
    </>
  );
}
