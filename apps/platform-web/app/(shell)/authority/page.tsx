import React from 'react';
import styles from '../workflows/page.module.css';
import { type RouteSearchParams } from '../../../lib/request-context';
import { AuthorityClient } from './AuthorityClient';

export default async function AuthorityPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === 'string') qs.set('account', params.account);
  if (typeof params.org === 'string') qs.set('org', params.org);
  const q = qs.toString() ? `?${qs.toString()}` : '';

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Decision Fabric</p>
          <h1 id="page-title">Approval Authority</h1>
          <p>Grant subjects the authority the decision gate enforces — a monetary approval ceiling, optionally scoped to an organization or delegated. This is what lets a governed decision carrying a monetary requirement (an expense approval, a high-value case) actually clear.</p>
        </div>
      </section>

      <AuthorityClient queryString={q} />
    </>
  );
}
