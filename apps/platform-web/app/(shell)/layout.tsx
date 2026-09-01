export const dynamic = "force-dynamic";
import { Suspense } from "react";
import { ShellFrame } from "../../components/ShellFrame/ShellFrame";
import { liveWorkspaceAdapter } from "../../lib/live-adapter";
import { isDenied } from "@expadio/ui/contracts";
import { compileScopedThemeCss } from "@expadio/ui";
import Loading from "./loading";
import { loadBrandAppOrigin } from "../../lib/brand-app";
import { loadPlatformEffectiveTheme } from "../../lib/effective-theme";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // Using the live adapter which fetches from our Next.js API route handlers
  const [sections, workspaceContext, overview, theme] = await Promise.all([
    liveWorkspaceAdapter.loadAllowedWorkspaces(), 
    liveWorkspaceAdapter.loadWorkspaceContext(), 
    liveWorkspaceAdapter.loadOverview("00000000-0000-0000-0000-000000000002"),
    loadPlatformEffectiveTheme()
  ]);
  if (isDenied(overview)) throw new Error("The fixture workspace could not be initialized.");
  const themeCss=compileScopedThemeCss(theme.theme,'platform');
  return <><style data-expadio-effective-theme="platform" dangerouslySetInnerHTML={{__html:themeCss}}/><Suspense fallback={<Loading/>}><ShellFrame sections={sections} workspaceContext={workspaceContext} overview={overview} brandAppOrigin={loadBrandAppOrigin()}>{children}</ShellFrame></Suspense></>;
}
