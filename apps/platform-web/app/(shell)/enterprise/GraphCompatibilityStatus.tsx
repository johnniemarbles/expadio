'use client';

import { useEffect, useState } from 'react';
import styles from './enterprise.module.css';

interface GraphCompatibility {
  readonly perspective: 'OPERATIONAL';
  readonly graphReadsEnabled: boolean;
  readonly rollbackMode: boolean;
  readonly driftFree: boolean;
  readonly driftCount: number;
  readonly driftCheckedAt: string | null;
  readonly driftFreeAt: string | null;
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly value: GraphCompatibility };

export function GraphCompatibilityStatus({ suffix }: { suffix: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/enterprise/graph/compatibility' + suffix, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.denied === true) {
          throw new Error(payload?.message ?? payload?.reasonKey ?? 'Compatibility proof is unavailable.');
        }
        setState({ kind: 'ready', value: payload as GraphCompatibility });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Compatibility proof is unavailable.',
        });
      });
    return () => controller.abort();
  }, [suffix]);

  return (
    <section className={styles.panel} aria-live="polite">
      <header>
        <div>
          <span>Migration safety</span>
          <h2>Graph compatibility proof</h2>
        </div>
        <small>Platform-governed rollout control</small>
      </header>
      <div className={styles.panelBody}>
        {state.kind === 'loading' ? (
          <p className={styles.help}>Checking the operational graph against the retained hierarchy model…</p>
        ) : state.kind === 'error' ? (
          <p className={styles.badState}>{state.message}</p>
        ) : (
          <>
            <div className={styles.summaryRow}>
              <span>Compatibility result</span>
              <strong className={state.value.driftFree ? styles.goodState : styles.badState}>
                {state.value.driftFree ? 'Aligned' : state.value.driftCount + ' drift item(s)'}
              </strong>
            </div>
            <div className={styles.summaryRow}>
              <span>Read mode</span>
              <strong className={state.value.graphReadsEnabled ? styles.goodState : styles.pendingState}>
                {state.value.graphReadsEnabled ? 'Governed graph enabled' : 'Legacy compatibility mode'}
              </strong>
            </div>
            <div className={styles.summaryRow}>
              <span>Safe rollback</span>
              <strong className={state.value.rollbackMode ? styles.goodState : styles.pendingState}>
                {state.value.rollbackMode ? 'Active' : 'Available by disabling graph reads'}
              </strong>
            </div>
            <p className={styles.help}>
              Brands can inspect this proof but cannot change the rollout switch. Platform operations
              enables graph reads only after drift-free evidence is recorded.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
