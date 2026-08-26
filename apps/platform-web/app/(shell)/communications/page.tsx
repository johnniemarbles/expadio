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

export default async function CommunicationsPage() {
  const [overview, providers, templates, fleet] = await Promise.all([
    fetchApi<CommunicationOverview>("/api/communications/overview"),
    fetchApi<ConnectorListItem[]>("/api/communications/providers"),
    fetchApi<TemplateCatalogueItem[]>("/api/communications/templates"),
    fetchApi<FleetHealthItem[]>("/api/communications/fleet"),
  ]);

  if (isDenied(overview)) return <DeniedState result={overview} />;

  return (
    <CommunicationsDashboardClient
      overview={overview}
      initialProviders={isDenied(providers) ? [] : providers}
      templates={isDenied(templates) ? [] : templates}
      fleet={isDenied(fleet) ? [] : fleet}
    />
  );
}
