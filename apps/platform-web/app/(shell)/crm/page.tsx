import { DeniedState } from "@expadio/ui";
import { isDenied } from "@expadio/ui/contracts";
import type { CrmAccount, CrmContact } from "@expadio/party";
import type { CrmLead } from "@expadio/lead";
import type { CrmCase } from "@expadio/case";
import type { CrmAgreement } from "@expadio/agreement";
import { findIndustryPack, resolveCrmVocabulary, resolveCaseWorkflowVocabulary, resolveCaseSchema, resolveCaseOntology, listIndustryPackChoices } from "@expadio/industry-packs";
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

  const [accounts, contacts, leads, cases, agreements, vertical] = await Promise.all([
    fetchApi<CrmAccount[]>(`/api/crm/accounts${q}`),
    fetchApi<(CrmContact & { accountName: string | null })[]>(`/api/crm/contacts${q}`),
    fetchApi<(CrmLead & { accountName: string | null })[]>(`/api/crm/leads${q}`),
    fetchApi<(CrmCase & { accountName: string | null })[]>(`/api/crm/cases${q}`),
    fetchApi<(CrmAgreement & { accountName: string | null })[]>(`/api/crm/agreements${q}`),
    fetchApi<{ verticalKey: string | null; choices: { verticalKey: string; label: string }[] }>(`/api/tenancy/vertical${q}`),
  ]);

  if (isDenied(accounts)) return <DeniedState result={accounts} />;

  // An explicit ?vertical= previews a pack; otherwise the tenant's saved binding
  // decides. No pack → the neutral engine's own words.
  const boundVertical = isDenied(vertical) ? null : vertical.verticalKey;
  const previewVertical = typeof params.vertical === "string" ? params.vertical : null;
  const activeVertical = previewVertical ?? boundVertical;
  const pack = findIndustryPack(activeVertical);
  const vocab = resolveCrmVocabulary(pack);
  const caseVocab = resolveCaseWorkflowVocabulary(pack);
  const caseSchema = resolveCaseSchema(pack);
  const caseOntology = resolveCaseOntology(pack);
  const choices = isDenied(vertical) ? listIndustryPackChoices() : vertical.choices;

  return (
    <CrmClient
      initialAccounts={isDenied(accounts) ? [] : accounts}
      initialContacts={isDenied(contacts) ? [] : contacts}
      initialLeads={isDenied(leads) ? [] : leads}
      initialCases={isDenied(cases) ? [] : cases}
      initialAgreements={isDenied(agreements) ? [] : agreements}
      vocab={vocab}
      caseVocab={caseVocab}
      caseSchema={caseSchema}
      caseOntology={caseOntology}
      verticalKey={activeVertical}
      verticalLabel={pack?.label ?? null}
      packChoices={choices}
      queryString={q}
    />
  );
}
