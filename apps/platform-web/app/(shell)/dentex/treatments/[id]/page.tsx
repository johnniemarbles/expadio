import TreatmentWorkspaceClient from './TreatmentWorkspaceClient';

export default async function DentexTreatmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TreatmentWorkspaceClient treatmentId={decodeURIComponent(id)} />;
}
