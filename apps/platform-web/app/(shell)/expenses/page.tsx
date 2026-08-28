import React from 'react';
import styles from '../workflows/page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { type RouteSearchParams } from '../../../lib/request-context';
import { ExpensesClient, type ExpenseRow } from './ExpensesClient';

export default async function ExpensesPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === 'string') qs.set('account', params.account);
  if (typeof params.org === 'string') qs.set('org', params.org);
  const q = qs.toString() ? `?${qs.toString()}` : '';

  const expenses = await fetchApi<ExpenseRow[]>(`/api/expenses${q}`);
  if (isDenied(expenses)) return <DeniedState result={expenses} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Decision Fabric</p>
          <h1 id="page-title">Expense Reimbursement</h1>
          <p>A third governed business process on the same engine: file an expense, route it to a manager, and approve it — the approval clearing a monetary threshold set by the amount itself.</p>
        </div>
      </section>

      <ExpensesClient initialExpenses={expenses} queryString={q} />
    </>
  );
}
