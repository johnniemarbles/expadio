"use client";
import styles from "./ScopePicker.module.css";
import type { PlatformOverview } from "../../lib/contracts";

export function ScopePicker({ organization }: { organization: PlatformOverview["organization"] }) {
  return (
    <label className={styles.scopeSelect}>
      <span>Active organization</span>
      <select defaultValue={organization.id} aria-label="Active organization">
        <option value={organization.id}>{organization.name}</option>
      </select>
    </label>
  );
}
