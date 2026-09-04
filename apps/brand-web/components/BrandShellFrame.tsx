'use client';

import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { ThemeModeControl, type ModuleShellDescriptor } from '@expadio/ui';
import { usePathname } from 'next/navigation';
import styles from '../app/(workspace)/workspace.module.css';

interface WorkspaceOption {
  readonly tenantId:string;
  readonly tenantName:string;
  readonly organizationId:string;
  readonly organizationName:string;
}

export function BrandShellFrame({
  children,
  tenantName,
  organizationName,
  workspaces,
  selectedWorkspace,
  modules,
}:{
  children:React.ReactNode;
  tenantName:string;
  organizationName:string;
  workspaces:readonly WorkspaceOption[];
  selectedWorkspace:string;
  modules:readonly ModuleShellDescriptor[];
}){
  const pathname=usePathname();
  const ordered=[...modules].sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name));
  const pinned=ordered.filter((module)=>module.defaultPinned).slice(0,5);
  const active=ordered.find((module)=>pathname===module.baseRoute||pathname.startsWith(module.baseRoute+'/'))??null;
  const enterpriseActive=pathname==='/enterprise'||pathname.startsWith('/enterprise/');
  const communicationsActive=pathname==='/communications'||pathname.startsWith('/communications/');

  return <div className={styles.shell} data-expadio-theme="brand">
    <aside className={styles.sidebar} aria-label="Brand navigation">
      <div className={styles.brandLockup}>
        <span className={styles.brandGlyph}>E</span>
        <span><strong>EXPADIO</strong><small>Brand workspace</small></span>
      </div>

      <nav className={styles.globalNav}>
        <p className={styles.navGroup}>Workspace</p>
        <Link className={pathname==='/'?styles.navActive:''} href="/">Home</Link>
        <Link className={pathname==='/brain'?styles.navActive:''} href="/brain"><span className={styles.navIcon}>BB</span>Brand Brain</Link>
        <Link
          className={pathname==='/enterprise'||pathname.startsWith('/enterprise/')?styles.navActive:''}
          href="/enterprise"
        ><span className={styles.navIcon}>EN</span>Enterprise</Link>
        <Link className={communicationsActive?styles.navActive:''} href="/communications"><span className={styles.navIcon}>CM</span>Communications</Link>
        <p className={styles.navGroup}>Apps</p>
        {pinned.map((module)=><Link
          key={module.key}
          href={module.baseRoute}
          className={active?.key===module.key?styles.navActive:''}
        ><span className={styles.navIcon}>{module.iconKey.slice(0,2).toUpperCase()}</span>{module.name}</Link>)}
        <Link className={styles.allAppsLink} href="/">＋ All Apps</Link>
        <p className={styles.navGroup}>Administration</p>
        <Link className={pathname==='/appearance'?styles.navActive:''} href="/appearance">Appearance</Link>
        <Link className={pathname==='/settings/brand'||pathname.startsWith('/settings/brand/')?styles.navActive:''} href="/settings/brand">Brand settings</Link>
      </nav>

      <div className={styles.sidebarBottom}>
        <form className={styles.workspaceSelect} action="/api/workspace/select" method="post">
          <label htmlFor="brand-workspace">Workspace</label>
          <input type="hidden" name="returnTo" value={pathname||'/'} />
          <select id="brand-workspace" name="workspace" defaultValue={selectedWorkspace}>
            {workspaces.map((workspace)=><option
              key={workspace.tenantId+':'+workspace.organizationId}
              value={workspace.tenantId+':'+workspace.organizationId}
            >{workspace.tenantName} · {workspace.organizationName}</option>)}
          </select>
          <button type="submit">Switch</button>
        </form>
      </div>
    </aside>

    <section className={styles.content}>
      <header className={styles.topbar}>
        <div className={styles.appContext}>
          {active
            ? <><span className={styles.appContextIcon}>{active.iconKey.slice(0,2).toUpperCase()}</span><div><strong>{active.name}</strong><small>{organizationName}</small></div></>
            : enterpriseActive
              ? <><span className={styles.appContextIcon}>EN</span><div><strong>Enterprise</strong><small>{organizationName}</small></div></>
              : communicationsActive
                ? <><span className={styles.appContextIcon}>CM</span><div><strong>Communications</strong><small>{organizationName}</small></div></>
                : <div><strong>{organizationName}</strong><small>{tenantName}</small></div>}
        </div>
        <div className={styles.topbarActions}>
          {active&&ordered.length>1?<details className={styles.appSwitcher}>
            <summary>Switch app</summary>
            <div>{ordered.map((module)=><Link key={module.key} href={module.baseRoute}>{module.name}</Link>)}</div>
          </details>:null}
          <ThemeModeControl />
          <UserButton appearance={{elements:{userButtonAvatarBox:{width:32,height:32}}}} />
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </section>
  </div>;
}
