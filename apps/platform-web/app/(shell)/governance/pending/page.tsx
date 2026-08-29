import React from 'react';
import styles from '../../workflows/page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { PendingReviewsClient, type PendingReview } from './PendingReviewsClient';

export default async function PendingReviewsPage() {
  const payload = await fetchApi<{ items: PendingReview[] }>(`/api/governance/pending-reviews`);
  if (isDenied(payload)) return <DeniedState result={payload} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Governance</p>
          <h1 id="page-title">Pending review load</h1>
          <p>Every open governed process waiting on a named reviewer to act — across case, vendor, expense and access request — and on whom, oldest first. The team-wide counterpart to a reviewer&apos;s personal queue: where is work piling up, and who is the bottleneck.</p>
        </div>
      </section>

      <PendingReviewsClient initial={payload.items ?? []} />
    </>
  );
}
