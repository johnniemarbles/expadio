import Link from 'next/link';
import { resolveBrandContext } from '../../lib/brand-context';
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
  const context = await resolveBrandContext();
  const selected = `${context.tenantId}:${context.organizationId}`;
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>EXPADIO<small>Brand workspace</small></div>
        <form className={styles.workspaceSelect} action="/api/workspace/select" method="post">
          <label htmlFor="workspace">Workspace</label>
          <input type="hidden" name="returnTo" value="/learning" />
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
