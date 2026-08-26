import { PlatformCommandCenter } from "../components/platform-command-center";
import { fixtureWorkspaceAdapter } from "../lib/fixture-adapter";

export default async function PlatformHome() {
  const overview = await fixtureWorkspaceAdapter.loadOverview("org_dreamware");

  return <PlatformCommandCenter overview={overview} />;
}
