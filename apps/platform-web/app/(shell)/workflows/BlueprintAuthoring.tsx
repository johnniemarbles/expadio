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

const badge = (state: string): React.CSSProperties => {
  const map: Record<string, string> = {
    ACTIVE: 'var(--theme-primary)', DRAFT: 'var(--theme-neutral)', IN_REVIEW: 'var(--theme-warning)', SUPERSEDED: 'var(--theme-neutral)', ARCHIVED: 'var(--theme-neutral)',
  };
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
    color: 'var(--theme-text-inverse)', background: map[state] ?? 'var(--theme-neutral)',
  };
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {platformKeys.map((b) => (
            <button
              key={b.blueprintKey}
              onClick={() => clone(b.blueprintKey)}
              disabled={busy !== null}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--theme-border)', background: 'var(--theme-text-inverse)', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
            >
              {busy === `clone:${b.blueprintKey}` ? 'Cloning…' : `Customize "${b.blueprintKey}"`}
            </button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: 'var(--theme-danger)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

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
                <td><span style={badge(b.state)}>{b.state}</span></td>
                <td>
                  {b.scope === 'TENANT' && (b.state === 'DRAFT' || b.state === 'IN_REVIEW') ? (
                    <button
                      onClick={() => publish(b.blueprintKey, b.version)}
                      disabled={busy !== null}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--theme-primary)', color: 'var(--theme-text-inverse)', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
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
