export type TenantScope = { tenantId: string; organizationId: string };
export type TenantIdentity = TenantScope & { subjectId: string };
export type Customer = {
  id: string; name: string; email: string | null; phone: string | null;
  status: string; accountName: string; createdAt: string; updatedAt: string;
};
export type CustomerCase = { id: string; subject: string; status: string; createdAt: string; updatedAt: string };
export type CustomerDecision = { id: string; caseId: string; caseSubject: string; outcome: string; decidedAt: string };
export type CustomerTask = {
  id: string; customerId: string; customerName: string; title: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED'; priority: string;
  dueAt: string | null; isMine: boolean; createdAt: string;
};
export type CustomerDetail = {
  customer: Customer; cases: CustomerCase[]; tasks: CustomerTask[]; decisions: CustomerDecision[];
  truncated: { cases: boolean; tasks: boolean; decisions: boolean };
};
export type TenantContext = { brand: string; organization: string; access: 'read-only' };
export type PageResult<T> = { items: T[]; hasMore: boolean };

// Display adapters never invent a transition or collapse an uncertain outcome.
export function businessStatus(value: string): string {
  const labels: Record<string, string> = {
    ACTIVE: 'Active', UNSUBSCRIBED: 'Unsubscribed', OPEN: 'Open', PENDING: 'Pending',
    RESOLVED: 'Resolved', CLOSED: 'Closed', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
    APPROVED: 'Approved', SCHEDULED: 'Scheduled', QUEUED: 'Queued for sending',
    SENT: 'Sent', DELIVERED: 'Delivered', FAILED: 'Failed',
    OUTCOME_UNCERTAIN: 'Outcome uncertain', AWAITING_REVIEW: 'Awaiting review',
    ALLOWED: 'Allowed', DENIED: 'Denied',
  };
  return labels[value] ?? 'Status not mapped';
}
