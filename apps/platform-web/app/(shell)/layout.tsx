import { Suspense } from "react";
import { ShellFrame } from "../../components/ShellFrame/ShellFrame";
import { fixtureWorkspaceAdapter } from "../../lib/fixture-adapter";
import { isDenied } from "@expadio/ui/contracts";
import Loading from "./loading";
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const [sections, workspaceContext, overview] = await Promise.all([fixtureWorkspaceAdapter.loadAllowedWorkspaces(), fixtureWorkspaceAdapter.loadWorkspaceContext(), fixtureWorkspaceAdapter.loadOverview("org_dreamware")]);
  if (isDenied(overview)) throw new Error("The fixture workspace could not be initialized.");
  return <Suspense fallback={<Loading/>}><ShellFrame sections={sections} workspaceContext={workspaceContext} overview={overview}>{children}</ShellFrame></Suspense>;
}
