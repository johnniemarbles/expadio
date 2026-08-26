"use client";

import { useMemo } from "react";
import { StatePill, EmptyState } from "@expadio/ui";
import type { CapabilitySummary } from "../../lib/contracts";
import styles from "./CapabilityTable.module.css";

export function CapabilityTable({
  capabilities,
  query,
}: {
  capabilities: CapabilitySummary[];
  query: string;
}) {
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return capabilities;
    return capabilities.filter((capability) =>
      [capability.name, capability.kind, capability.scope, capability.state]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [capabilities, query]);

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Capability</th>
            <th>Type</th>
            <th>Scope</th>
            <th>Status</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((capability) => (
            <tr key={capability.id}>
              <td>
                <span className={styles.capabilityName}>{capability.name}</span>
                <span className={styles.version}>{capability.version}</span>
              </td>
              <td>{capability.kind}</td>
              <td>{capability.scope}</td>
              <td><StatePill state={capability.state} /></td>
              <td className={styles.muted}>{capability.updated}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 ? (
        <EmptyState
          title="No capabilities match"
          description="Try a name, type, scope, or status."
        />
      ) : null}
    </div>
  );
}
