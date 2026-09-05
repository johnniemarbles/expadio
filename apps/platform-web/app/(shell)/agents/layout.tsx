"use client";
import styles from './layout.module.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/agents', label: 'Runs', exact: true },
<<<<<<< HEAD
  { href: '/agents/catalog', label: 'Catalog' },
  { href: '/agents/bindings', label: 'Active Bindings' },
=======
  { href: '/agents/bindings', label: 'Bindings' },
>>>>>>> origin/main
  { href: '/agents/registry', label: 'Registry' },
];

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <h1 className={styles.title}>Agent Intelligence</h1>
        <nav className={styles.nav} aria-label="Agent Intelligence sections">
          {navItems.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[styles.navLink, active ? styles.active : ''].join(' ')}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
