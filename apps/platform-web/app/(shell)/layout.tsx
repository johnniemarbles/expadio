import { Suspense } from "react";
import { ShellFrame } from "../../components/ShellFrame/ShellFrame";
import { liveWorkspaceAdapter } from "../../lib/live-adapter";
import { isDenied } from "@expadio/ui/contracts";
import Loading from "./loading";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // Using the live adapter which fetches from our Next.js API route handlers
  const [sections, workspaceContext, overview] = await Promise.all([
    liveWorkspaceAdapter.loadAllowedWorkspaces(), 
    liveWorkspaceAdapter.loadWorkspaceContext(), 
    liveWorkspaceAdapter.loadOverview("org_dreamware")
  ]);
  if (isDenied(overview)) throw new Error("The fixture workspace could not be initialized.");
  return <Suspense fallback={<Loading/>}><ShellFrame sections={sections} workspaceContext={workspaceContext} overview={overview}>{children}</ShellFrame></Suspense>;
}
