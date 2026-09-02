import { liveWorkspaceAdapter, liveWorkspaceSource } from "../../../lib/live-adapter";
import styles from "../page.module.css";
import { isDenied } from "@expadio/ui/contracts";
import { WiringBanner, DeniedState, ActivityTimeline, EmptyState } from "@expadio/ui";
import { requestedOrganizationId, type RouteSearchParams } from "../../../lib/request-context";
export default async function AuditPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const result = await liveWorkspaceAdapter.loadActivity(await requestedOrganizationId(searchParams));
  if (isDenied(result)) return <DeniedState result={result} />;
  return <><WiringBanner source={liveWorkspaceSource}/><section className={styles.pageHeading} aria-labelledby="page-title"><div><p className={styles.eyebrow}>Command center</p><h1 id="page-title">Audit</h1><p>Trace governed events in the active scope.</p></div></section><section className={styles.panel} aria-labelledby="audit-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Traceable references</p><h2 id="audit-title">Audit timeline</h2></div></div>{result.length ? <ActivityTimeline items={result}/> : <EmptyState title="No audit activity" description="No governed events exist in the active workspace yet."/>}</section></>;
}
