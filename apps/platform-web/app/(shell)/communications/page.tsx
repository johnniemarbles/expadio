import { DeniedState } from "@expadio/ui";
import { isDenied } from "@expadio/ui/contracts";
import type {
  CommunicationOverview,
} from "../../../lib/communication-contracts";
import type { ConnectorListItem } from "../../api/communications/providers/route";
import type { TemplateCatalogueItem } from "../../api/communications/templates/route";
import type { FleetHealthItem } from "../../api/communications/fleet/route";
import { fetchApi } from "../../../lib/live-adapter";
import { CommunicationsDashboardClient } from "./CommunicationsDashboardClient";
import styles from "./page.module.css";

export default async function CommunicationsPage() {
  const [overview, providers, templates, fleet] = await Promise.all([
    fetchApi<CommunicationOverview>("/api/communications/overview"),
    fetchApi<ConnectorListItem[]>("/api/communications/providers"),
    fetchApi<TemplateCatalogueItem[]>("/api/communications/templates"),
    fetchApi<FleetHealthItem[]>("/api/communications/fleet"),
  ]);

  if (isDenied(overview)) return <DeniedState result={overview} />;

  return (
    <>
      {/* Platform Heading */}
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform Administration · Composed Control Plane</p>
          <h1 id="page-title">Communications &amp; Provider Registry</h1>
          <p>
            Governed delivery infrastructure, template libraries, DNS/DKIM authentication, and fleet health telemetry.
          </p>
        </div>
        <div className={styles.liveBadge} aria-label="Live database connection">
          <span aria-hidden="true" /> Live database
        </div>
      </section>

      <CommunicationsDashboardClient
        overview={overview}
        initialProviders={isDenied(providers) ? [] : providers}
        templates={isDenied(templates) ? [] : templates}
        fleet={isDenied(fleet) ? [] : fleet}
      />
    </>
  );
}
