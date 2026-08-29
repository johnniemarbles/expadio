import React from 'react';
import styles from '../../workflows/page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { ReviewQueueClient, type ReviewQueueItem } from './ReviewQueueClient';

export default async function ReviewQueuePage() {
  const [payload, vertical] = await Promise.all([
    fetchApi<{ items: ReviewQueueItem[] }>(`/api/governance/queue`),
    fetchApi<{ verticalKey: string | null }>(`/api/tenancy/vertical`),
  ]);
  if (isDenied(payload)) return <DeniedState result={payload} />;
  const verticalKey = isDenied(vertical) ? null : vertical.verticalKey;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Governance</p>
          <h1 id="page-title">Your review queue</h1>
          <p>Every open governed process waiting on you to act — across case, vendor, expense and access request — in one place, oldest first. The reviewer&apos;s companion to the tenant-wide in-flight and decision views.</p>
        </div>
      </section>

      <ReviewQueueClient initial={payload.items ?? []} verticalKey={verticalKey} />
    </>
  );
}
