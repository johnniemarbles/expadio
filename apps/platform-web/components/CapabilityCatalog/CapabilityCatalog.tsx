"use client";

import { useState } from "react";
import { SearchField } from "@expadio/ui";
import { CapabilityTable } from "../CapabilityTable/CapabilityTable";
import type { CapabilitySummary } from "../../lib/contracts";
import styles from "../../app/(shell)/page.module.css";

export function CapabilityCatalog({ capabilities }: { capabilities: CapabilitySummary[] }) {
  const [query, setQuery] = useState("");

  return (
    <section className={styles.panel} aria-labelledby="capability-catalog-title">
      <div className={`${styles.panelHeading} ${styles.panelHeadingResponsive}`}>
        <div>
          <p className={styles.eyebrow}>Published and in progress</p>
          <h2 id="capability-catalog-title">Capability catalog</h2>
        </div>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Filter capabilities"
          label="Filter capabilities"
        />
      </div>
      <CapabilityTable capabilities={capabilities} query={query} />
    </section>
  );
}
