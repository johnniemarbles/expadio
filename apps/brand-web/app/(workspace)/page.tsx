import { listTenantProductModules } from '@expadio/postgres-runtime/product-module';
import { ModuleLauncher } from '../../components/ModuleLauncher';
import { resolveBrandContext, withBrandTransaction } from '../../lib/brand-context';
import styles from './workspace.module.css';

export const dynamic = 'force-dynamic';

function routeFromManifest(manifest: Readonly<Record<string, unknown>>): string | null {
  const route = manifest.route;
  return typeof route === 'string' && route.startsWith('/') && !route.startsWith('//')
    ? route
    : null;
}

function label(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function BrandHome() {
  const context = await resolveBrandContext();
  const modules = await withBrandTransaction(
    context,
    (client) => listTenantProductModules(client, context.tenantId),
  );
  const active = modules.filter((module) => module.availability === 'ACTIVE').length;
  const ready = modules.filter((module) => module.availability === 'READY_TO_ACTIVATE').length;
  const locked = modules.filter((module) => module.availability === 'LOCKED_BY_PLAN').length;

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Brand workspace</p>
          <h1>Apps</h1>
          <p>Open the capabilities available to {context.tenantName}. App state comes from Platform entitlement and installation records; this dashboard cannot grant itself a plan entitlement.</p>
        </div>
      </section>

      <section className={styles.appStats}>
        <article className={styles.metric}><div className={styles.metricLabel}>Active apps</div><div className={styles.metricValue}>{active}</div><div className={styles.metricDetail}>Ready to use now</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Ready to activate</div><div className={styles.metricValue}>{ready}</div><div className={styles.metricDetail}>Entitled but not installed</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Plan locked</div><div className={styles.metricValue}>{locked}</div><div className={styles.metricDetail}>Requires Platform commercial entitlement</div></article>
      </section>

      <section className={styles.appGrid}>
        {modules.map((module) => (
          <article className={styles.appCard} key={module.moduleKey}>
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
                route={routeFromManifest(module.manifest)}
              />
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
