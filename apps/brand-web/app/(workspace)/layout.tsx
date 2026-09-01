import Link from 'next/link';
import { BrandContextError, resolveBrandContext } from '../../lib/brand-context';
import styles from './workspace.module.css';

const NAV = [
  ['Overview', '/learning'],
  ['Courses', '/learning/courses'],
  ['AI tutor & author', '/learning/ai'],
  ['Learners', '/learning/learners'],
  ['Assessments', '/learning/assessments'],
  ['Programs & credentials', '/learning/programs'],
  ['Skills', '/learning/skills'],
  ['Assignments', '/learning/assignments'],
  ['Reports', '/learning/reports'],
  ['Settings', '/learning/settings'],
] as const;

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  let context;
  try {
    context = await resolveBrandContext();
  } catch (error) {
    if (error instanceof BrandContextError && error.code === 'NO_BRAND_MEMBERSHIP') {
      return (
        <main className={styles.accessShell}>
          <section className={styles.accessCard}>
            <div className={styles.accessMark}>EXPADIO</div>
            <p className={styles.eyebrow}>Brand workspace access</p>
            <h1>No Brand workspace assigned</h1>
            <p>
              Your identity is authenticated, but it is not assigned to an active tenant
              and organization in EXPADIO. A Platform administrator must grant Brand
              membership before this workspace can be opened.
            </p>
            <div className={styles.accessHint}>
              Access is intentionally not auto-provisioned from Brand.
            </div>
          </section>
        </main>
      );
    }
    throw error;
  }
  const selected = `${context.tenantId}:${context.organizationId}`;
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>EXPADIO<small>Brand workspace</small></div>
        <form className={styles.workspaceSelect} action="/api/workspace/select" method="post">
          <label htmlFor="workspace">Workspace</label>
          <input type="hidden" name="returnTo" value="/" />
          <select id="workspace" name="workspace" defaultValue={selected}>
            {context.workspaces.map((workspace) => (
              <option key={`${workspace.tenantId}:${workspace.organizationId}`} value={`${workspace.tenantId}:${workspace.organizationId}`}>
                {workspace.tenantName} · {workspace.organizationName}
              </option>
            ))}
          </select>
          <button className={styles.button} type="submit">Switch</button>
        </form>
        <nav className={styles.nav} aria-label="Brand navigation">
          <div className={styles.navGroup}>Apps</div>
          <Link href="/">Home</Link>
          <div className={styles.navGroup}>Learning</div>
          {NAV.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
          <div className={styles.navGroup}>Learner</div>
          <Link href="/learn">My learning</Link>
        </nav>
        <div className={styles.sidebarFoot}>Tenant product shell · separate from Platform administration</div>
      </aside>
      <section className={styles.content}>
        <header className={styles.topbar}><div><div className={styles.scopeTitle}>{context.organizationName}</div><div className={styles.scopeSub}>{context.tenantName}</div></div></header>
        <main className={styles.main}>{children}</main>
      </section>
    </div>
  );
}
