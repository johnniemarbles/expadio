export const dynamic = "force-dynamic";
import { Suspense } from "react";
import { ShellFrame } from "../../components/ShellFrame/ShellFrame";
import { liveWorkspaceAdapter } from "../../lib/live-adapter";
import { isDenied } from "@expadio/ui/contracts";
import { compileScopedThemeCss, ToastProvider } from "@expadio/ui";
import Loading from "./loading";
import { redirect } from "next/navigation";
import { loadBrandAppOrigin } from "../../lib/brand-app";
import { loadPlatformEffectiveTheme } from "../../lib/effective-theme";
import { requestedOrganizationId } from "../../lib/request-context";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // Resolve the effective organization through the same membership boundary as
  // API handlers. A seeded identifier is data, never authorization context.
  let organizationId: string | null = null;
  try {
    organizationId = await requestedOrganizationId();
  } catch (err: any) {
    if (err?.name === "ContextDenied" || err?.denied?.denied) {
      redirect("/sign-in");
    }
    throw err;
  }

  const [sections, workspaceContext, overview, theme] = await Promise.all([
    liveWorkspaceAdapter.loadAllowedWorkspaces(),
    liveWorkspaceAdapter.loadWorkspaceContext(),
    liveWorkspaceAdapter.loadOverview(organizationId),
    loadPlatformEffectiveTheme()
  ]);

  if (isDenied(overview)) {
    throw new Error("The authorized workspace could not be loaded.");
  }

  const themeCss = compileScopedThemeCss(theme.theme, "platform");
  return <><style data-expadio-effective-theme="platform" dangerouslySetInnerHTML={{ __html: themeCss }} /><Suspense fallback={<Loading />}><ToastProvider><ShellFrame sections={sections} workspaceContext={workspaceContext} overview={overview} brandAppOrigin={loadBrandAppOrigin()}>{children}</ShellFrame></ToastProvider></Suspense></>;
}
