import { DeniedState } from "@expadio/ui";
import { isDenied } from "@expadio/ui/contracts";
import type { CrmAccount, CrmContact } from "@expadio/party";
import { fetchApi } from "../../../lib/live-adapter";
import { CrmClient } from "./CrmClient";

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === "string") qs.set("account", params.account);
  if (typeof params.org === "string") qs.set("org", params.org);
  const q = qs.toString() ? `?${qs.toString()}` : "";

  const [accounts, contacts] = await Promise.all([
    fetchApi<CrmAccount[]>(`/api/crm/accounts${q}`),
    fetchApi<(CrmContact & { accountName: string | null })[]>(`/api/crm/contacts${q}`),
  ]);

  if (isDenied(accounts)) return <DeniedState result={accounts} />;

  return (
    <CrmClient
      initialAccounts={isDenied(accounts) ? [] : accounts}
      initialContacts={isDenied(contacts) ? [] : contacts}
      queryString={q}
    />
  );
}
