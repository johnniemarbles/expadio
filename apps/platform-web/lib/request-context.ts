export type RouteSearchParams = Promise<Record<string, string | string[] | undefined>>;
export async function requestedOrganizationId(searchParams: RouteSearchParams): Promise<string> {
  const value = (await searchParams).org;
  return typeof value === "string" && value.trim() !== "" ? value : "00000000-0000-0000-0000-000000000002";
}
