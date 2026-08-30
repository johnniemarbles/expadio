import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { fetchApi } from '../../../../lib/live-adapter';
import { DomainEventOperationsClient } from './DomainEventOperationsClient';

export interface DomainEventOperationItem {
  outboxId: string;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: 'PENDING' | 'CLAIMED' | 'FAILED' | 'DEAD' | 'PUBLISHED';
  attempts: number;
  availableAt: string;
  claimedAt: string | null;
  publishedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface Payload {
  items: DomainEventOperationItem[];
  counts: {
    total: number;
    dead: number;
    failed: number;
    claimed: number;
    pending: number;
    published: number;
  };
}

export default async function DomainEventOperationsPage() {
  const payload = await fetchApi<Payload>('/api/governance/domain-events?limit=200');
  if (isDenied(payload)) return <DeniedState result={payload} />;

  return <DomainEventOperationsClient initial={payload} />;
}
