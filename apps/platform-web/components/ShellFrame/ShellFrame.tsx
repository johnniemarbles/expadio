"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SourceBadge } from "@expadio/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../../app/(shell)/layout.module.css";
import type { PlatformOverview, PlatformWorkspaceContext, WorkspaceSection } from "../../lib/contracts";

export function ShellFrame({ children, sections, overview, workspaceContext }: { children: React.ReactNode; sections: WorkspaceSection[]; overview: PlatformOverview; workspaceContext: PlatformWorkspaceContext; }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const currentAccount = workspaceContext.accounts.find((item) => item.id === searchParams.get("account")) ?? workspaceContext.accounts[0];
  const allowedOrganizations = useMemo(() => currentAccount ? workspaceContext.organizations.filter((item) => currentAccount.allowedOrganizationIds.includes(item.id)) : [], [currentAccount, workspaceContext.organizations]);
  const currentOrganization = allowedOrganizations.find((item) => item.id === searchParams.get("org")) ?? allowedOrganizations[0] ?? overview.organization;
  const currentSection = sections.find((item) => item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/")) ?? sections[0];

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    closeButtonRef.current?.focus();
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [mobileOpen]);

  function href(path: string) {
    const params = new URLSearchParams();
    if (currentAccount) params.set("account", currentAccount.id);
    params.set("org", currentOrganization.id);
    return path + "?" + params.toString();
  }
  function replaceContext(accountId: string, orgId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("account", accountId); params.set("org", orgId);
    router.push(pathname + "?" + params.toString());
  }
  function chooseAccount(accountId: string) {
    const account = workspaceContext.accounts.find((item) => item.id === accountId);
    const organization = workspaceContext.organizations.find((item) => account?.allowedOrganizationIds.includes(item.id));
    if (account && organization) replaceContext(account.id, organization.id);
    setAccountOpen(false);
  }

  return <div className={styles.appShell}>
    <aside className={[styles.sidebar, mobileOpen ? styles.sidebarOpen : ""].join(" ")}>
      <div className={styles.brand}><span className={styles.brandMark}>E</span><span><strong>EXPADIO</strong><small>Platform</small></span><button ref={closeButtonRef} className={styles.mobileClose} onClick={() => setMobileOpen(false)} aria-label="Close navigation">×</button></div>
      <nav className={styles.primaryNav} aria-label="Platform sections"><p className={styles.navLabel}>Workspace</p>{sections.map((section) => <Link href={href(section.href)} className={[styles.navItem, currentSection?.id === section.id ? styles.navItemActive : ""].join(" ")} key={section.id} aria-current={currentSection?.id === section.id ? "page" : undefined}><span className={styles.navIcon}>{section.short}</span><span>{section.label}</span></Link>)}</nav>
      <div className={styles.sidebarFoot}>
        <div className={styles.systemStatus}><span className={styles.fixtureLight}/><span><strong>Health not connected</strong><small>Fixture workspace status</small></span></div>
        <div className={styles.accountArea}>
          <button className={styles.accountCard} onClick={() => setAccountOpen((value) => !value)} aria-expanded={accountOpen} aria-controls="account-menu"><span className={styles.avatar}>{currentAccount?.initials ?? "EX"}</span><span><strong>{currentAccount?.name ?? "Fixture account"}</strong><small>{currentAccount?.role ?? "Account adapter pending"}</small></span><span>⌄</span></button>
          {accountOpen && <div id="account-menu" className={styles.accountMenu} role="menu"><p>Fixture accounts</p>{workspaceContext.accounts.map((account) => <button key={account.id} role="menuitem" onClick={() => chooseAccount(account.id)} aria-current={account.id === currentAccount?.id ? "true" : undefined}><span className={styles.avatar}>{account.initials}</span><span><strong>{account.name}</strong><small>{account.role}</small></span></button>)}<small className={styles.adapterNote}>Live sign-in adapter not connected.</small></div>}
        </div>
      </div>
    </aside>
    {mobileOpen && <button className={styles.overlay} onClick={() => setMobileOpen(false)} aria-label="Close navigation"/>}
    <main className={styles.main}>
      <header className={styles.topbar}>
        <button className={styles.mobileMenu} onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen}>☰</button>
        <div className={styles.breadcrumb}><span>Platform</span><span>/</span><strong>{currentSection?.label ?? "Overview"}</strong></div>
        <div className={styles.topbarActions}>
          <label className={styles.scopePicker}><span className="sr-only">Active organization</span><select value={currentOrganization.id} onChange={(event) => replaceContext(currentAccount?.id ?? "account_platform", event.target.value)}>{allowedOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{"— ".repeat(organization.level === "platform" ? 0 : organization.level === "country" ? 1 : organization.level === "region" ? 2 : 3)}{organization.name}</option>)}</select></label>
          <SourceBadge source={overview.source}/>
          <div className={styles.notificationArea}><button className={styles.iconButton} aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((value) => !value)}>◎</button>{notificationsOpen && <div className={styles.notificationPanel} role="status"><strong>Notifications not connected</strong><span>Live alerts will appear after the notification adapter is available.</span></div>}</div>
        </div>
      </header>
      <div className={styles.content}>{children}</div>
    </main>
  </div>;
}
