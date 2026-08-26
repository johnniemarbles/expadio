"use client";
import styles from './layout.module.css';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
const navItems = [
  { href: '/brain', label: 'Overview', exact: true },
  { href: '/brain/sources', label: 'Sources' },
  { href: '/brain/slices', label: 'Context Slices' },
  { href: '/brain/corrections', label: 'Corrections' },
  { href: '/brain/review', label: 'Review Queue' },
  { href: '/brain/history', label: 'Publication History' },
  { href: '/brain/provenance', label: 'Provenance' },
];
export default function BrainLayout({ children }: { children: React.ReactNode }) {
  const pathname=usePathname(), params=useSearchParams();
  const suffix=params.toString() ? '?'+params.toString() : '';
  return <div className={styles.layout}><header className={styles.header}><h1 className={styles.title}>Company Brain</h1><nav className={styles.nav} aria-label="Company Brain sections">{navItems.map((item) => {const active=item.exact ? pathname===item.href : pathname.startsWith(item.href); return <Link key={item.href} href={item.href+suffix} className={[styles.navLink,active?styles.active:''].join(' ')} aria-current={active?'page':undefined}>{item.label}</Link>;})}</nav></header><main className={styles.main}>{children}</main></div>;
}
