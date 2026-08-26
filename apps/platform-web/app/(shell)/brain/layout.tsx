"use client";

import styles from './layout.module.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/brain', label: 'Overview', exact: true },
  { href: '/brain/sources', label: 'Sources', exact: false },
  { href: '/brain/slices', label: 'Context Slices', exact: false },
  { href: '/brain/corrections', label: 'Corrections', exact: false },
  { href: '/brain/review', label: 'Review Queue', exact: false },
  { href: '/brain/history', label: 'Publication History', exact: false },
  { href: '/brain/provenance', label: 'Provenance', exact: false },
];

export default function BrainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <h1 className={styles.title}>Company Brain</h1>
        <nav className={styles.nav}>
          {navItems.map(item => {
            const isActive = item.exact ? pathname === item.href : pathname?.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href} 
                className={`${styles.navLink} ${isActive ? styles.active : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
