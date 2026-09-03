"use client";

import { useCallback, useEffect, useState } from "react";
import { MotionPanel, MotionCard } from '@expadio/ui';
import styles from "./page.module.css";
import recoveryStyles from "./LegacyDeliveryRecoveryPanel.module.css";

interface LegacyDelivery {
  deliveryId: string;
  channel: string;
  connectorKey: string;
  adapterKey: string;
  attemptCount: number;
  requestedAt: string;
  updatedAt: string;
  recoveryStatus: "MIGRATION_REQUIRED";
}

export function LegacyDeliveryRecoveryPanel({ queryString = "" }: { queryString?: string }) {
  const [items, setItems] = useState<LegacyDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(queryString.startsWith("?") ? queryString.slice(1) : queryString);
      params.set("limit", "200");
      const response = await fetch(`/api/communications/recovery/legacy-deliveries?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? data.message ?? "Could not load legacy deliveries.");
      setItems(data.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load legacy deliveries.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(item: LegacyDelivery) {
    const reason = prompt(
      "Why should this legacy delivery be cancelled? The original row has no immutable prepared-dispatch snapshot, so it cannot be safely executed. This reason is written to the recovery audit.",
    )?.trim();
    if (!reason) return;
    if (!confirm(
      "Cancel this legacy delivery permanently? Any required resend must be created as a fresh governed action.",
    )) return;

    setBusy(item.deliveryId);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams(queryString.startsWith("?") ? queryString.slice(1) : queryString);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(
        `/api/communications/recovery/legacy-deliveries/${encodeURIComponent(item.deliveryId)}/cancel${suffix}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-expadio-reauth-at": new Date().toISOString(),
          },
          body: JSON.stringify({ reason }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? data.message ?? "Legacy delivery recovery failed.");
      setNotice(`Legacy delivery cancelled with immutable recovery evidence. Correlation: ${data.correlationId}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Legacy delivery recovery failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <MotionPanel className={styles.attentionTablePanel}>
      <div className={styles.attentionPanelHeading}>
        <div>
          <h3>Legacy delivery recovery</h3>
          <p>
            PENDING deliveries created before durable prepared-dispatch snapshots are non-executable.
            Resolve them explicitly; never reconstruct historical send state.
          </p>
        </div>
        <span className={styles.tag}>{items.length} migration required</span>
      </div>

      {error ? (
        <div role="alert" className={`${recoveryStyles.banner} ${recoveryStyles.error}`}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className={`${recoveryStyles.banner} ${recoveryStyles.notice}`}>
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className={recoveryStyles.state}>Loading recovery queue…</div>
      ) : items.length === 0 ? (
        <div className={recoveryStyles.state}>
          No legacy PENDING deliveries require migration recovery.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Delivery</th>
                <th>Channel</th>
                <th>Connector</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Attempts</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.deliveryId}>
                  <td><code>{item.deliveryId}</code></td>
                  <td>{item.channel}</td>
                  <td><code>{item.connectorKey}</code></td>
                  <td className={recoveryStyles.migrationStatus}>{item.recoveryStatus}</td>
                  <td>{new Date(item.requestedAt).toLocaleString()}</td>
                  <td>{item.attemptCount}</td>
                  <td>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void resolve(item)}
                      className={recoveryStyles.resolveButton}
                    >
                      {busy === item.deliveryId ? "Resolving…" : "Cancel legacy row"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </MotionPanel>
  );
}
