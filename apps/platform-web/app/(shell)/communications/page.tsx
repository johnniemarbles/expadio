import { DeniedState } from "@expadio/ui";
import { isDenied } from "@expadio/ui/contracts";
import type { CommunicationOverview } from "../../../lib/communication-contracts";
import type { ConnectorListItem } from "../../api/communications/providers/route";
import type { TemplateCatalogueItem } from "../../api/communications/templates/route";
import type { FleetHealthItem } from "../../api/communications/fleet/route";
import { fetchApi } from "../../../lib/live-adapter";
import { CommunicationsDashboardClient } from "./CommunicationsDashboardClient";

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === 'string') qs.set('account', params.account);
  if (typeof params.org === 'string') qs.set('org', params.org);
  const q = qs.toString() ? `?${qs.toString()}` : '';

  // Capacity/spend and decision-trace data are fetched client-side by their
  // own panels (CapacityPanel, TracesPanel), so the page only prefetches the
  // four datasets the default views render.
  const [overview, providers, templates, fleet] = await Promise.all([
    fetchApi<CommunicationOverview>(`/api/communications/overview${q}`),
    fetchApi<ConnectorListItem[]>(`/api/communications/providers${q}`),
    fetchApi<TemplateCatalogueItem[]>(`/api/communications/templates${q}`),
    fetchApi<FleetHealthItem[]>(`/api/communications/fleet${q}`),
  ]);

  if (isDenied(overview)) return <DeniedState result={overview} />;

  return (
    <CommunicationsDashboardClient
      overview={overview}
      initialProviders={isDenied(providers) ? [] : providers}
      templates={isDenied(templates) ? [] : templates}
      fleet={isDenied(fleet) ? [] : fleet}
      queryString={q}
    />
  );
}
