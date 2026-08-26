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
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const accountAreaRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const notificationAreaRef = useRef<HTMLDivElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const currentAccount = workspaceContext.accounts.find((item) => item.id === searchParams.get("account")) ?? workspaceContext.accounts[0];
  const allowedOrganizations = useMemo(() => currentAccount ? workspaceContext.organizations.filter((item) => currentAccount.allowedOrganizationIds.includes(item.id)) : [], [currentAccount, workspaceContext.organizations]);
  const currentOrganization = allowedOrganizations.find((item) => item.id === searchParams.get("org")) ?? allowedOrganizations[0] ?? overview.organization;
  const currentSection = sections.find((item) => item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/")) ?? sections[0];

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
    setNotificationsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        requestAnimationFrame(() => mobileMenuRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", listener);
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!accountOpen && !notificationsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (accountOpen && !accountAreaRef.current?.contains(target)) setAccountOpen(false);
      if (notificationsOpen && !notificationAreaRef.current?.contains(target)) setNotificationsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (accountOpen) {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      }
      if (notificationsOpen) {
        setNotificationsOpen(false);
        notificationButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen, notificationsOpen]);

  function href(path: string) {
    const params = new URLSearchParams();
    if (currentAccount) params.set("account", currentAccount.id);
    params.set("org", currentOrganization.id);
    return path + "?" + params.toString();
  }
  function replaceContext(accountId: string, orgId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("account", accountId);
    params.set("org", orgId);
    router.push(pathname + "?" + params.toString());
  }
  function chooseAccount(accountId: string) {
    const account = workspaceContext.accounts.find((item) => item.id === accountId);
    const organization = workspaceContext.organizations.find((item) => account?.allowedOrganizationIds.includes(item.id));
    if (account && organization) replaceContext(account.id, organization.id);
    setAccountOpen(false);
    requestAnimationFrame(() => accountButtonRef.current?.focus());
  }

  return <div className={styles.appShell}>
    <aside ref={sidebarRef} className={[styles.sidebar, mobileOpen ? styles.sidebarOpen : ""].join(" ")} aria-label="Platform navigation">
      <div className={styles.brand}><span className={styles.brandMark}>E</span><span><strong>EXPADIO</strong><small>Platform</small></span><button type="button" ref={closeButtonRef} className={styles.mobileClose} onClick={() => { setMobileOpen(false); mobileMenuRef.current?.focus(); }} aria-label="Close navigation"><span aria-hidden="true">×</span></button></div>
      <nav className={styles.primaryNav} aria-label="Platform sections"><p className={styles.navLabel}>Workspace</p>{sections.map((section) => <Link href={href(section.href)} className={[styles.navItem, currentSection?.id === section.id ? styles.navItemActive : ""].join(" ")} key={section.id} aria-current={currentSection?.id === section.id ? "page" : undefined}><span className={styles.navIcon}>{section.short}</span><span>{section.label}</span></Link>)}</nav>
      <div className={styles.sidebarFoot}>
        <div className={styles.systemStatus}><span className={styles.fixtureLight}/><span><strong>Health not connected</strong><small>Fixture workspace status</small></span></div>
        <div ref={accountAreaRef} className={styles.accountArea}>
          <button type="button" ref={accountButtonRef} className={styles.accountCard} onClick={() => { setAccountOpen((value) => !value); setNotificationsOpen(false); }} aria-expanded={accountOpen} aria-haspopup="menu" aria-controls="account-menu"><span className={styles.avatar}>{currentAccount?.initials ?? "EX"}</span><span><strong>{currentAccount?.name ?? "Fixture account"}</strong><small>{currentAccount?.role ?? "Account adapter pending"}</small></span><span aria-hidden="true">⌄</span></button>
          {accountOpen && <div id="account-menu" className={styles.accountMenu} role="menu" aria-label="Fixture accounts"><p>Fixture accounts</p>{workspaceContext.accounts.map((account) => <button type="button" key={account.id} role="menuitem" onClick={() => chooseAccount(account.id)} aria-current={account.id === currentAccount?.id ? "true" : undefined}><span className={styles.avatar}>{account.initials}</span><span><strong>{account.name}</strong><small>{account.role}</small></span></button>)}<small className={styles.adapterNote}>Live sign-in adapter not connected.</small></div>}
        </div>
      </div>
    </aside>
    {mobileOpen && <button type="button" className={styles.overlay} onClick={() => { setMobileOpen(false); mobileMenuRef.current?.focus(); }} aria-label="Close navigation"/>}
    <main className={styles.main} aria-hidden={mobileOpen ? true : undefined}>
      <header className={styles.topbar}>
        <button type="button" ref={mobileMenuRef} className={styles.mobileMenu} onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen}><span aria-hidden="true">☰</span></button>
        <div className={styles.breadcrumb}><span>Platform</span><span>/</span><strong>{currentSection?.label ?? "Overview"}</strong></div>
        <div className={styles.topbarActions}>
          <label className={styles.scopePicker}><span className="sr-only">Active organization</span><select value={currentOrganization.id} onChange={(event) => replaceContext(currentAccount?.id ?? "account_platform", event.target.value)}>{allowedOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{"— ".repeat(organization.level === "platform" ? 0 : organization.level === "country" ? 1 : organization.level === "region" ? 2 : 3)}{organization.name}</option>)}</select></label>
          <span className={styles.sourceContext}><SourceBadge source={overview.source}/></span>
          <div ref={notificationAreaRef} className={styles.notificationArea}><button type="button" ref={notificationButtonRef} className={styles.iconButton} aria-label="Notifications" aria-expanded={notificationsOpen} aria-controls="notification-panel" onClick={() => { setNotificationsOpen((value) => !value); setAccountOpen(false); }}><span aria-hidden="true">◎</span></button>{notificationsOpen && <div id="notification-panel" className={styles.notificationPanel} role="region" aria-label="Notifications status"><strong>Notifications not connected</strong><span>Live alerts will appear after the notification adapter is available.</span></div>}</div>
        </div>
      </header>
      <div className={styles.content}>{children}</div>
    </main>
  </div>;
}
