import React from 'react';
import styles from './OperationalState.module.css';
import type { DashboardState, DegradedExplanation, LifecycleError } from '../operational-state.js';

type ActionTarget = {
  readonly label: string;
  readonly href?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
};

function Action({ action }: { readonly action: ActionTarget }) {
  if (action.href) {
    return <a className={styles.action} href={action.href}>{action.label}</a>;
  }
  return <button type="button" className={styles.action} onClick={action.onClick} disabled={action.disabled}>{action.label}</button>;
}

export function DashboardSkeleton({ rows = 3 }: { readonly rows?: number | undefined }) {
  return (
    <div className={[styles.surface, styles.skeletonStack].join(' ')} aria-busy="true" aria-label="Loading dashboard content">
      {Array.from({ length: rows }).map((_, index) => {
        const widthClass = index % 3 === 0 ? styles.skeletonLineWide : index % 3 === 1 ? styles.skeletonLineMedium : styles.skeletonLineShort;
        return <div key={index} className={[styles.skeletonLine, widthClass].join(' ')} />;
      })}
    </div>
  );
}

export function InlineErrorBanner({ error, onRetry }: { readonly error: LifecycleError; readonly onRetry?: (() => void) | undefined }) {
  return (
    <section className={[styles.surface, styles.banner, styles.error].join(' ')} role="alert" aria-labelledby="dashboard-error-title">
      <div className={styles.bannerHeader}>
        <h3 id="dashboard-error-title" className={styles.title}>Dashboard error</h3>
        <span className={styles.meta}>{error.code}</span>
      </div>
      <p className={styles.message}>{error.message}</p>
      {onRetry ? <div className={styles.actionRow}><Action action={{ label: error.retryLabel ?? 'Retry', onClick: onRetry }} /></div> : null}
    </section>
  );
}

export function EntitlementDeniedCard({ title = 'Capability unavailable', message, action }: { readonly title?: string | undefined; readonly message: string; readonly action?: ActionTarget | undefined }) {
  return (
    <section className={[styles.surface, styles.banner, styles.denied].join(' ')} role="alert" aria-labelledby="dashboard-denied-title">
      <div className={styles.bannerHeader}>
        <h3 id="dashboard-denied-title" className={styles.title}>🔒 {title}</h3>
      </div>
      <p className={styles.message}>{message}</p>
      {action ? <div className={styles.actionRow}><Action action={action} /></div> : null}
    </section>
  );
}

export function DegradedConsole({ explanation }: { readonly explanation: DegradedExplanation }) {
  return (
    <section className={[styles.surface, styles.banner, styles.degraded].join(' ')} role="status" aria-labelledby="dashboard-degraded-title">
      <div className={styles.bannerHeader}>
        <h3 id="dashboard-degraded-title" className={styles.title}>Degraded operation</h3>
        <span className={styles.meta}>DEGRADED</span>
      </div>
      <div className={styles.fieldGrid}>
        <div className={styles.field}><strong>Blast Radius</strong><span>{explanation.blastRadius}</span></div>
        <div className={styles.field}><strong>Root Cause</strong><span>{explanation.rootCause}</span></div>
        <div className={styles.actionRow}>
          <Action action={{ label: explanation.remediationLabel, href: explanation.remediationHref }} />
        </div>
      </div>
    </section>
  );
}

export function OperationalStateBoundary({ state, children, onRetry, deniedMessage, notEntitledMessage, upgradeHref }: { readonly state: DashboardState; readonly children: React.ReactNode; readonly onRetry?: (() => void) | undefined; readonly deniedMessage?: string | undefined; readonly notEntitledMessage?: string | undefined; readonly upgradeHref?: string | undefined }) {
  if (state.lifecycle === 'LOADING') return <DashboardSkeleton />;
  if (state.lifecycle === 'ERROR' && state.error) return <InlineErrorBanner error={state.error} onRetry={onRetry} />;
  if (state.lifecycle === 'DENIED') return <EntitlementDeniedCard title="Access denied" message={deniedMessage ?? 'You do not have permission to view this dashboard.'} />;
  if (state.lifecycle === 'NOT_ENTITLED') return <EntitlementDeniedCard title="Plan upgrade required" message={notEntitledMessage ?? 'This capability is not included in the current plan.'} action={upgradeHref ? { label: 'Review plan', href: upgradeHref } : undefined} />;
  if (state.health === 'DEGRADED' && state.degraded) {
    return <><DegradedConsole explanation={state.degraded} />{children}</>;
  }
  return <>{children}</>;
}
