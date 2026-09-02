'use client';

import { useState } from 'react';
import styles from './page.module.css';
import type { BlueprintSummary } from '../../../lib/workflow-blueprints';

/**
 * Tenant blueprint authoring surface. Lists every blueprint visible to the
 * tenant (platform catalogue + this tenant's own versions), and lets a tenant
 * admin clone a platform default into a DRAFT and publish a draft ACTIVE. Once
 * a tenant version is ACTIVE, new case workflows resolve it over the platform
 * default for the same work type.
 */

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
  }
  return fallback;
}

const badgeClass = (state: string): string => {
  if (state === 'ACTIVE') return [styles.statusBadge, styles.statusPositive].join(' ');
  if (state === 'IN_REVIEW') return [styles.statusBadge, styles.statusWarning].join(' ');
  return [styles.statusBadge, styles.statusNeutral].join(' ');
};

export function BlueprintAuthoring({ blueprints, queryString = '' }: { blueprints: BlueprintSummary[]; queryString?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Platform blueprint keys the tenant can clone (deduplicated).
  const platformKeys = Array.from(
    new Map(blueprints.filter((b) => b.scope === 'PLATFORM').map((b) => [b.blueprintKey, b])).values(),
  );

  async function clone(blueprintKey: string) {
    setBusy(`clone:${blueprintKey}`); setError(null);
    try {
      const res = await fetch(`/api/blueprints${queryString}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blueprintKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not create the draft.'));
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the draft.');
      setBusy(null);
    }
  }

  async function publish(blueprintKey: string, version: number) {
    setBusy(`publish:${blueprintKey}:${version}`); setError(null);
    try {
      const res = await fetch(`/api/blueprints/publish${queryString}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blueprintKey, version }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, 'Could not publish the blueprint.'));
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not publish the blueprint.');
      setBusy(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="blueprints-title">
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>Authoring</p>
          <h2 id="blueprints-title">Workflow Blueprints</h2>
        </div>
        <div className={styles.toolbar}>
          {platformKeys.map((b) => (
            <button
              key={b.blueprintKey}
              onClick={() => clone(b.blueprintKey)}
              disabled={busy !== null}
              className={[styles.button, styles.buttonSecondary].join(' ')}
            >
              {busy === `clone:${b.blueprintKey}` ? 'Cloning…' : `Customize "${b.blueprintKey}"`}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className={[styles.inlineAlert, styles.inlineAlertDanger].join(' ')}>{error}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Blueprint</th>
              <th>Work type</th>
              <th>Scope</th>
              <th>Version</th>
              <th>Stages</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {blueprints.map((b) => (
              <tr key={`${b.scope}:${b.blueprintKey}:${b.version}`}>
                <td><strong>{b.label}</strong><br /><span className={styles.code}>{b.blueprintKey}</span></td>
                <td className={styles.muted}>{b.workTypeKey}</td>
                <td>{b.scope}</td>
                <td>{b.version}</td>
                <td>{b.stageCount}</td>
                <td><span className={badgeClass(b.state)}>{b.state}</span></td>
                <td>
                  {b.scope === 'TENANT' && (b.state === 'DRAFT' || b.state === 'IN_REVIEW') ? (
                    <button
                      onClick={() => publish(b.blueprintKey, b.version)}
                      disabled={busy !== null}
                      className={styles.button}
                    >
                      {busy === `publish:${b.blueprintKey}:${b.version}` ? 'Publishing…' : 'Publish'}
                    </button>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
