import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import type { CrmAccount, CrmContact } from '@expadio/party';
import { fetchApi } from '../../../lib/live-adapter';
import DentexOperationsClient from './DentexOperationsClient';

type PatientRow = CrmContact & { accountName: string | null };

export default async function DentexOperationsPage() {
  const [practices, patients] = await Promise.all([
    fetchApi<CrmAccount[]>('/api/crm/accounts'),
    fetchApi<PatientRow[]>('/api/crm/contacts'),
  ]);

  if (isDenied(practices)) return <DeniedState result={practices} />;
  if (isDenied(patients)) return <DeniedState result={patients} />;

  return (
    <DentexOperationsClient
      initialPractices={practices}
      initialPatients={patients}
    />
  );
}
