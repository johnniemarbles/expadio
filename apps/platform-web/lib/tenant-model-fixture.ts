import type { CustomerDetail, CustomerTask } from './tenant-contracts';

// Explicit read-only model, never used by an API or as a live-request fallback.
const task: CustomerTask = { id: 'model-task', customerId: 'model-jordan', customerName: 'Jordan Lee',
  title: 'Review the onboarding follow-up', status: 'OPEN', priority: 'NORMAL', dueAt: null, isMine: true, createdAt: '2026-08-20T09:00:00Z' };
export const modelCustomer: CustomerDetail = {
  customer: { id: 'model-jordan', name: 'Jordan Lee', email: 'jordan@example.invalid', phone: null,
    status: 'ACTIVE', accountName: 'Northstar customer account', createdAt: '2026-08-18T09:00:00Z', updatedAt: '2026-08-20T09:00:00Z' },
  cases: [{ id: 'model-case', subject: 'New customer onboarding', status: 'PENDING', createdAt: '2026-08-18T09:00:00Z', updatedAt: '2026-08-20T09:00:00Z' }],
  tasks: [task], decisions: [], truncated: { cases: false, tasks: false, decisions: false },
};
