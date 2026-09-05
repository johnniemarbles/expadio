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

function BrandNavIcon({ label, iconKey }: { label: string; iconKey?: string }) {
  const key = (iconKey || label).toLowerCase();
  const iconProps = { width: 15, height: 15, strokeWidth: 1.75, fill: "none", stroke: "currentColor" };

  if (key.includes('home') || key.includes('dashboard')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    );
  }
  if (key.includes('brain') || key.includes('bb') || key.includes('ai')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z" />
        <path d="M12 6v6l4 2" />
      </svg>
    );
  }
  if (key.includes('mission') || key.includes('agent') || key.includes('am')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
      </svg>
    );
  }
  if (key.includes('enterprise') || key.includes('en') || key.includes('org')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
        <path d="M6 12H4a2 2 0 0 0-2 2v8h20v-8a2 2 0 0 0-2-2h-2" />
      </svg>
    );
  }
  if (key.includes('comm') || key.includes('cm') || key.includes('radio')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M4.9 19.1C1.9 16.1 1.9 11.3 4.9 8.3" />
        <circle cx="12" cy="12" r="2" />
        <path d="M19.1 4.9c3 3 3 7.8 0 10.8" />
      </svg>
    );
  }
  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
    </svg>
  );
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
        <Link className={pathname==='/'?styles.navActive:''} href="/"><span className={styles.navIcon}><BrandNavIcon label="Home" /></span>Home</Link>
        <Link className={pathname==='/brain'?styles.navActive:''} href="/brain"><span className={styles.navIcon}><BrandNavIcon label="Brain" /></span>Brain</Link>
        <Link className={pathname==='/brain/missions'?styles.navActive:''} href="/brain/missions"><span className={styles.navIcon}><BrandNavIcon label="Missions" /></span>Missions</Link>
        <Link
          className={pathname==='/enterprise'||pathname.startsWith('/enterprise/')?styles.navActive:''}
          href="/enterprise"
        ><span className={styles.navIcon}><BrandNavIcon label="Enterprise" /></span>Enterprise</Link>
        <Link className={communicationsActive?styles.navActive:''} href="/communications"><span className={styles.navIcon}><BrandNavIcon label="Communications" /></span>Comms</Link>
        <p className={styles.navGroup}>Apps</p>
        {pinned.map((module)=><Link
          key={module.key}
          href={module.baseRoute}
          className={active?.key===module.key?styles.navActive:''}
        ><span className={styles.navIcon}><BrandNavIcon label={module.name} iconKey={module.iconKey} /></span>{module.name}</Link>)}
        <Link className={styles.allAppsLink} href="/">＋ Apps</Link>
        <p className={styles.navGroup}>Administration</p>
        <Link className={pathname==='/appearance'?styles.navActive:''} href="/appearance">Appearance</Link>
        <Link className={pathname==='/settings/brand'||pathname.startsWith('/settings/brand/')?styles.navActive:''} href="/settings/brand">Brand</Link>
        <Link className={pathname==='/settings/agents'||pathname.startsWith('/settings/agents/')?styles.navActive:''} href="/settings/agents">Agents</Link>
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
            ? <><span className={styles.appContextIcon}><BrandNavIcon label={active.name} iconKey={active.iconKey} /></span><div><strong>{active.name}</strong><small>{organizationName}</small></div></>
            : enterpriseActive
              ? <><span className={styles.appContextIcon}><BrandNavIcon label="Enterprise" /></span><div><strong>Enterprise</strong><small>{organizationName}</small></div></>
              : communicationsActive
                ? <><span className={styles.appContextIcon}><BrandNavIcon label="Communications" /></span><div><strong>Communications</strong><small>{organizationName}</small></div></>
                : <div><strong>{organizationName}</strong><small>{tenantName}</small></div>}
        </div>

        {/* Sleek Header Telemetry Indicator */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', background: 'var(--theme-surface)', borderRadius: 'var(--theme-radius-control)', border: '1px solid var(--theme-border)', fontSize: 11, fontFamily: 'var(--theme-font-mono)', whiteSpace: 'nowrap' }} title={`BYOK: Twilio · Resend · Meta API | Gate: LOCAL_SIGN_OFF`}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 8px rgba(34,197,94,0.6)' }} aria-hidden="true" />
          <span style={{ color: 'var(--theme-text-secondary)', fontWeight: 600 }}>{organizationName || 'OpCo'}</span>
          <span style={{ color: 'var(--theme-text-muted)', fontSize: 10 }}>(L1)</span>
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
