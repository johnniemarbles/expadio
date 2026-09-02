import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { fetchApi } from '../../../lib/live-adapter';
import type { RouteSearchParams } from '../../../lib/request-context';
import { EnterpriseHub, type EnterpriseHubData } from './EnterpriseHub';
import styles from './enterprise.module.css';

export default async function EnterprisePage({
  searchParams,
}: {
  searchParams: RouteSearchParams | Promise<RouteSearchParams>;
}) {
  const resolved = await searchParams;
  const query = new URLSearchParams();
  if (typeof resolved.account === 'string') query.set('account', resolved.account);
  if (typeof resolved.org === 'string') query.set('org', resolved.org);
  const suffix = query.size > 0 ? '?' + query.toString() : '';

  const data = await fetchApi<EnterpriseHubData>(
    '/api/enterprise/commercial/portfolio' + suffix,
  );
  if (isDenied(data)) return <DeniedState result={data} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="enterprise-title">
        <div>
          <p className={styles.eyebrow}>Enterprise control plane</p>
          <h1 id="enterprise-title">Enterprise Hub</h1>
          <p>
            Govern structure, legal identity, setup readiness, commercial authority,
            territory rights, and jurisdiction activation from one hierarchy-aware workspace.
          </p>
        </div>
        <div className={styles.contextBadge}>
          <span>Enterprise</span>
          <strong>{data.scope.enterpriseId}</strong>
        </div>
      </section>
      <EnterpriseHub data={data} suffix={suffix} />
    </>
  );
}
