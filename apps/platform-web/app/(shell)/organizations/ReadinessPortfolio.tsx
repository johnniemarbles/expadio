'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import styles from './readiness.module.css';

export interface ReadinessPortfolioItem {
  setup_plan_id: string;
  organization_id: string;
  organization_name: string;
  organization_kind: string;
  organization_status: string;
  state: string;
  total_requirements: number;
  completed_requirements: number;
  blocking_open_requirements: number;
  completion_percent: string | number;
  depth: number;
  updated_at: string;
}

function stateLabel(state: string): string {
  if (state === 'READY_FOR_ACTIVATION') return 'Ready for activation';
  if (state === 'CONFIGURING') return 'Configuring';
  if (state === 'PROVISIONING') return 'Provisioning';
  if (state === 'ACTIVATED') return 'Activated';
  return state.replaceAll('_', ' ');
}

export function ReadinessPortfolio({
  items,
}: {
  items: ReadinessPortfolioItem[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activating, setActivating] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function activate(item: ReadinessPortfolioItem) {
    setActivating(item.setup_plan_id);
    setError('');
    try {
      const params = new URLSearchParams(searchParams.toString());
      const response = await fetch(
        '/api/enterprise/setup/plans/' +
          item.setup_plan_id +
          '/activate?' +
          params.toString(),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'x-correlation-id': crypto.randomUUID(),
          },
          body: JSON.stringify({
            reason: 'Activated from the parent organization readiness portfolio.',
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body.message ?? 'The organization could not be activated.');
        return;
      }
      router.refresh();
    } catch {
      setError('The organization could not be activated.');
    } finally {
      setActivating(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        No descendant organizations currently have an onboarding or readiness plan.
      </div>
    );
  }

  return (
    <div className={styles.portfolio}>
      {items.map((item) => {
        const completion = Number(item.completion_percent);
        const ready = item.state === 'READY_FOR_ACTIVATION';
        return (
          <article className={styles.item} key={item.setup_plan_id}>
            <div className={styles.top}>
              <div>
                <h3>{item.organization_name}</h3>
                <div className={styles.meta}>
                  <span>{item.organization_kind}</span>
                  <span>•</span>
                  <span>Depth {item.depth}</span>
                  <span>•</span>
                  <span>{item.completed_requirements}/{item.total_requirements} complete</span>
                </div>
              </div>
              <span className={[styles.badge, ready ? styles.ready : ''].join(' ')}>
                {stateLabel(item.state)}
              </span>
            </div>

            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: completion + '%' }} />
            </div>
            <div className={styles.progressMeta}>
              <span>{completion.toFixed(0)}% complete</span>
              <span>{item.blocking_open_requirements} blocking open</span>
            </div>

            {ready && (
              <div className={styles.actions}>
                <button
                  className={styles.activate}
                  type="button"
                  disabled={activating === item.setup_plan_id}
                  onClick={() => void activate(item)}
                >
                  {activating === item.setup_plan_id ? 'Activating…' : 'Activate organization'}
                </button>
              </div>
            )}
          </article>
        );
      })}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
