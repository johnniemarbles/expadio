"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SourceBadge, ThemeModeControl } from "@expadio/ui";
import { UserButton } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../../app/(shell)/layout.module.css";
import type { PlatformOverview, PlatformWorkspaceContext, WorkspaceSection } from "../../lib/contracts";
import { CommandPalette, type SearchProvider } from "./CommandPalette";

const GROUP_ORDER = new Map([
  ["Workspace", 0],
  ["Infrastructure", 1],
  ["Governance", 2],
  ["Administration", 3],
]);

function matchesSection(pathname: string, section: WorkspaceSection) {
  return section.href === "/" ? pathname === "/" : pathname === section.href || pathname.startsWith(section.href + "/");
}

function sectionDepth(section: WorkspaceSection) {
  return section.href === "/" ? 0 : section.href.split("/").filter(Boolean).length;
}

function priorityRank(section: WorkspaceSection) {
  return section.priority === "secondary" ? 1 : 0;
}

function groupRank(group: string) {
  return GROUP_ORDER.get(group) ?? 99;
}

export function ShellFrame({ children, sections, overview, workspaceContext, brandAppOrigin }: { children: React.ReactNode; sections: WorkspaceSection[]; overview: PlatformOverview; workspaceContext: PlatformWorkspaceContext; brandAppOrigin: string | null; }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
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
  const selectableOrganizations = allowedOrganizations.length > 0 ? allowedOrganizations : [currentOrganization];
  const currentSection = [...sections].sort((a, b) => sectionDepth(b) - sectionDepth(a)).find((item) => matchesSection(pathname, item)) ?? sections[0];
  const navGroups = useMemo(() => {
    const grouped = new Map<string, WorkspaceSection[]>();
    for (const section of sections) {
      const group = section.group ?? "Workspace";
      grouped.set(group, [...(grouped.get(group) ?? []), section]);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => groupRank(left) - groupRank(right) || left.localeCompare(right))
      .map(([group, items]) => ({
        group,
        items: [...items].sort((left, right) =>
          priorityRank(left) - priorityRank(right) || sectionDepth(left) - sectionDepth(right) || left.label.localeCompare(right.label),
        ),
      }));
  }, [sections]);
  const brandHref = useMemo(() => {
    if (!brandAppOrigin || !currentAccount || !currentOrganization) return null;
    const url = new URL('/handoff', brandAppOrigin);
    url.searchParams.set('tenant', currentAccount.id);
    url.searchParams.set('org', currentOrganization.id);
    url.searchParams.set('returnTo', '/');
    return url.toString();
  }, [brandAppOrigin, currentAccount, currentOrganization]);

  const searchProviders = useMemo<SearchProvider[]>(() => {
    return [
      {
        id: "organizations",
        label: "Organizations",
        search: (query) => {
          if (!query) return [];
          return selectableOrganizations
            .filter((org) => org.name.toLowerCase().includes(query) || org.id.toLowerCase().includes(query))
            .map((org) => ({
              id: "org_" + org.id,
              label: "Switch Org: " + org.name,
              short: "🏢",
              group: "Organizations",
              description: org.level + " level (" + org.id + ")",
              onSelect: () => replaceContext(currentAccount?.id ?? "account_platform", org.id),
            }));
        },
      },
      {
        id: "accounts",
        label: "Accounts",
        search: (query) => {
          if (!query) return [];
          return workspaceContext.accounts
            .filter((acc) => acc.name.toLowerCase().includes(query) || acc.role.toLowerCase().includes(query))
            .map((acc) => ({
              id: "acc_" + acc.id,
              label: "Switch Account: " + acc.name,
              short: "👤",
              group: "Accounts",
              description: acc.role,
              onSelect: () => chooseAccount(acc.id),
            }));
        },
      },
      ...(brandHref
        ? [
            {
              id: "brand_handoff",
              label: "External Applications",
              search: (query: string) => {
                if (!query || "brand".includes(query) || "studio".includes(query)) {
                  return [
                    {
                      id: "brand_app",
                      label: "Open Brand Workspace",
                      short: "⊞",
                      group: "External Applications",
                      description: "Handoff to brand workspace",
                      href: brandHref,
                    },
                  ];
                }
                return [];
              },
            },
          ]
        : []),
    ];
  }, [selectableOrganizations, currentAccount, workspaceContext.accounts, brandHref]);

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
    setNotificationsOpen(false);
    setCommandOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  return <div className={styles.appShell} data-expadio-theme="platform">
    <aside ref={sidebarRef} className={[styles.sidebar, mobileOpen ? styles.sidebarOpen : ""].join(" ")} aria-label="Platform navigation">
      <div className={styles.brand}><span className={styles.brandMark}>E</span><span><strong>EXPADIO</strong><small>Platform</small></span><button type="button" ref={closeButtonRef} className={styles.mobileClose} onClick={() => { setMobileOpen(false); mobileMenuRef.current?.focus(); }} aria-label="Close navigation"><span aria-hidden="true">×</span></button></div>
      <nav className={styles.primaryNav} aria-label="Platform sections">{navGroups.map(({ group, items }) => <section className={styles.navGroup} key={group} aria-label={group}><p className={styles.navLabel}>{group}</p><div className={styles.navGroupItems}>{items.map((section) => <Link href={href(section.href)} className={[styles.navItem, section.priority === "secondary" ? styles.navItemSecondary : "", currentSection?.id === section.id ? styles.navItemActive : ""].join(" ")} key={section.id} aria-current={currentSection?.id === section.id ? "page" : undefined}><span className={styles.navIcon}>{section.short}</span><span>{section.label}</span></Link>)}</div></section>)}</nav>
      <div className={styles.sidebarFoot}>
        <div className={styles.systemStatus}><span className={[styles.fixtureLight, styles.fixtureConnected].join(" ")} /><span><strong>Platform Connected</strong><small>Live workspace status</small></span></div>
        <div ref={accountAreaRef} className={styles.userAccountWrapper}>
          <UserButton appearance={{ elements: { userButtonAvatarBox: { width: 32, height: 32 } } }} />
          <div className={styles.userIdentityText}>
            <strong className={styles.userIdentityTitle}>My Account</strong>
            <small className={styles.userIdentitySub}>Manage Identity</small>
          </div>
        </div>
      </div>
    </aside>
    {mobileOpen && <button type="button" className={styles.overlay} onClick={() => { setMobileOpen(false); mobileMenuRef.current?.focus(); }} aria-label="Close navigation"/>}
    <main className={styles.main} aria-hidden={mobileOpen ? true : undefined}>
      <header className={styles.topbar}>
        <button type="button" ref={mobileMenuRef} className={styles.mobileMenu} onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen}><span aria-hidden="true">☰</span></button>
        
        {/* Global Search Button */}
        <button
          type="button"
          className={styles.searchBar}
          onClick={() => setCommandOpen(true)}
          aria-label="Open command palette (Cmd+K)"
        >
          <span style={{ fontSize: '13px', color: 'var(--ink-400)' }}>🔍</span>
          <span className={styles.searchInput} style={{ display: 'inline-flex', alignItems: 'center' }}>
            Quick jump or search...
          </span>
          <span className={styles.searchKbd}>⌘K</span>
        </button>

        <div className={styles.topbarActions}>
          <label className={styles.scopePicker}><span className="sr-only">Active organization</span><select value={currentOrganization.id} onChange={(event) => replaceContext(currentAccount?.id ?? "account_platform", event.target.value)}>{selectableOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{"— ".repeat(organization.level === "platform" ? 0 : organization.level === "country" ? 1 : organization.level === "region" ? 2 : 3)}{organization.name}</option>)}</select></label>
          
          <ThemeModeControl />

          <span className={styles.sourceContext}><SourceBadge source={overview.source}/></span>
          <div ref={notificationAreaRef} className={styles.notificationArea}>
            <button
              type="button"
              ref={notificationButtonRef}
              className={styles.iconButton}
              aria-label={`Notifications (${overview.reviews.length} pending)`}
              aria-expanded={notificationsOpen}
              aria-controls="notification-panel"
              onClick={() => {
                setNotificationsOpen((value) => !value);
                setAccountOpen(false);
              }}
            >
              <span aria-hidden="true">◎</span>
              {overview.reviews.length > 0 && (
                <span className={styles.notificationBadge}>{overview.reviews.length}</span>
              )}
            </button>
            {notificationsOpen && (
              <div id="notification-panel" className={styles.notificationPanel} role="region" aria-label="Notifications center">
                <div className={styles.notificationHeader}>
                  <span>Notifications &amp; Alerts</span>
                  <span style={{ fontSize: '11px', color: 'var(--theme-text-muted)', fontWeight: 500 }}>
                    {overview.reviews.length} pending reviews
                  </span>
                </div>
                {overview.reviews.length === 0 && overview.activity.length === 0 ? (
                  <div className={styles.notificationEmpty}>No pending alerts or notifications.</div>
                ) : (
                  <div className={styles.notificationList}>
                    {overview.reviews.map((rev) => (
                      <Link
                        key={rev.id}
                        href={href("/governance")}
                        className={styles.notificationItem}
                        onClick={() => setNotificationsOpen(false)}
                      >
                        <div className={styles.notificationItemTitle}>
                          <span>{rev.title}</span>
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "2px 6px",
                              borderRadius: "var(--theme-radius-card)",
                              fontWeight: 700,
                              background:
                                rev.risk === "High"
                                  ? "color-mix(in srgb, var(--theme-danger, #ef4444) 15%, transparent)"
                                  : rev.risk === "Medium"
                                  ? "color-mix(in srgb, var(--theme-warning, #f59e0b) 15%, transparent)"
                                  : "color-mix(in srgb, var(--theme-success, #10b981) 15%, transparent)",
                              color:
                                rev.risk === "High"
                                  ? "var(--theme-danger, #ef4444)"
                                  : rev.risk === "Medium"
                                  ? "var(--theme-warning, #f59e0b)"
                                  : "var(--theme-success, #10b981)",
                            }}
                          >
                            {rev.risk} Risk
                          </span>
                        </div>
                        <div className={styles.notificationItemMeta}>
                          Requested by {rev.requestedBy} • {rev.age}
                        </div>
                      </Link>
                    ))}
                    {overview.activity.slice(0, 3).map((act) => (
                      <Link
                        key={act.id}
                        href={href("/audit")}
                        className={styles.notificationItem}
                        onClick={() => setNotificationsOpen(false)}
                      >
                        <div className={styles.notificationItemTitle}>
                          <span>{act.actor} {act.action} {act.target}</span>
                        </div>
                        <div className={styles.notificationItemMeta}>
                          {act.timeLabel ?? act.time}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <div className={styles.content}>{children}</div>
      <CommandPalette
        isOpen={commandOpen}
        onClose={() => setCommandOpen(false)}
        sections={sections}
        contextQuery={currentOrganization ? "?org=" + encodeURIComponent(currentOrganization.id) : ""}
        providers={searchProviders}
      />
    </main>
  </div>;
}
