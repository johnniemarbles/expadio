'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '../workspace.module.css';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <nav className={styles.moduleTabs} aria-label="Settings navigation">
        <Link
          href="/settings/brand"
          className={pathname === '/settings/brand' || pathname.startsWith('/settings/brand/') ? styles.moduleTabActive : ''}
        >
          Brand Settings
        </Link>
        <Link
          href="/settings/agents"
          className={pathname === '/settings/agents' || pathname.startsWith('/settings/agents/') ? styles.moduleTabActive : ''}
        >
          AI Agents
        </Link>
      </nav>
      {children}
    </>
  );
}
