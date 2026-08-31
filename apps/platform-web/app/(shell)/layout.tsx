export const dynamic = "force-dynamic";
import { Suspense } from "react";
import { ShellFrame } from "../../components/ShellFrame/ShellFrame";
import { liveWorkspaceAdapter, liveWorkspaceSource } from "../../lib/live-adapter";
import { isDenied } from "@expadio/ui/contracts";
import { SHELL_PLATFORM_SECTIONS } from "../../lib/platform-product-surface";
import type { PlatformOverview, PlatformWorkspaceContext, WorkspaceSection } from "../../lib/contracts";
import Loading from "./loading";

const FALLBACK_OVERVIEW: PlatformOverview = {
  organization: {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Dreamware Platform",
    environment: "production",
    level: "platform",
    parentId: null,
  },
  source: liveWorkspaceSource,
  metrics: [],
  capabilities: [],
  reviews: [],
  activity: [],
};

const FALLBACK_CONTEXT: PlatformWorkspaceContext = { accounts: [], organizations: [] };

async function loadShell(): Promise<{
  sections: WorkspaceSection[];
  workspaceContext: PlatformWorkspaceContext;
  overview: PlatformOverview;
}> {
  let sections: WorkspaceSection[] = SHELL_PLATFORM_SECTIONS;
  let workspaceContext = FALLBACK_CONTEXT;
  let overview = FALLBACK_OVERVIEW;

  try {
    const loaded = await liveWorkspaceAdapter.loadAllowedWorkspaces();
    if (Array.isArray(loaded) && loaded.length > 0) sections = loaded;
  } catch {
    sections = SHELL_PLATFORM_SECTIONS;
  }

  try {
    workspaceContext = await liveWorkspaceAdapter.loadWorkspaceContext();
  } catch {
    workspaceContext = FALLBACK_CONTEXT;
  }

  try {
    const loaded = await liveWorkspaceAdapter.loadOverview("00000000-0000-0000-0000-000000000002");
    if (!isDenied(loaded) && loaded && "organization" in loaded) {
      overview = { ...loaded, source: loaded.source ?? liveWorkspaceSource };
    }
  } catch {
    overview = FALLBACK_OVERVIEW;
  }

  return { sections, workspaceContext, overview };
}

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const { sections, workspaceContext, overview } = await loadShell();
  return (
    <Suspense fallback={<Loading />}>
      <ShellFrame sections={sections} workspaceContext={workspaceContext} overview={overview}>
        {children}
      </ShellFrame>
    </Suspense>
  );
}
