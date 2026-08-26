"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SourceBadge } from "@expadio/ui";
import styles from "./layout.module.css";
import { fixtureWorkspaceAdapter } from "../../lib/fixture-adapter";
import { useEffect, useState } from "react";
import type { WorkspaceSection, PlatformOverview } from "../../lib/contracts";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sections, setSections] = useState<WorkspaceSection[]>([]);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);

  useEffect(() => {
    fixtureWorkspaceAdapter.loadAllowedWorkspaces().then(setSections);
    fixtureWorkspaceAdapter.loadOverview("org_dreamware").then(setOverview);
  }, []);

  const currentSection = sections.find(s => s.href === pathname) || sections[0];

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">E</span>
          <span>
            <strong>EXPADIO</strong>
            <small>Platform</small>
          </span>
        </div>

        <nav className={styles.primaryNav} aria-label="Platform sections">
          <p className={styles.navLabel}>Workspace</p>
          {sections.map((section) => (
            <Link
              href={section.href}
              className={`${styles.navItem} ${pathname === section.href ? styles.navItemActive : ""}`}
              key={section.id}
              aria-current={pathname === section.href ? "page" : undefined}
            >
              <span className={styles.navIcon} aria-hidden="true">{section.short}</span>
              <span>{section.label}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarFoot}>
          <div className={styles.systemStatus}>
            <span className={styles.statusLight} aria-hidden="true" />
            <span><strong>Systems healthy</strong><small>All gateways operational</small></span>
          </div>
          <button className={styles.accountCard} type="button" aria-label="Open account menu">
            <span className={styles.avatar}>JM</span>
            <span><strong>Johnnie Marbles</strong><small>Platform owner</small></span>
            <span aria-hidden="true">···</span>
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.mobileMenu} type="button" aria-label="Open navigation">☰</button>
          <div className={styles.breadcrumb}>
            <span>Platform</span>
            <span aria-hidden="true">/</span>
            <strong>{currentSection?.label || "Overview"}</strong>
          </div>
          <div className={styles.topbarActions}>
            {overview && <SourceBadge source={overview.source} />}
            <button className={styles.iconButton} type="button" aria-label="Notifications">
              <span aria-hidden="true">◎</span>
              <span className={styles.notificationDot} />
            </button>
          </div>
        </header>

        <div className={styles.content}>
          {children}
        </div>
      </main>
    </div>
  );
}
