import { ChiefOfStaffApprovalError } from '../chief-of-staff-orchestrator.ts';

export interface TelegramCallbackUpdate {
  readonly callbackQueryId: string;
  readonly telegramUserId: number;
  readonly data: string;
}

export interface TelegramLinkResolver {
  resolveSubject(telegramUserId: number): Promise<{ readonly tenantId: string; readonly subjectId: string } | null>;
}

export interface ApprovalResolutionPort {
  resolve(input: {
    readonly tenantId: string;
    readonly approverSubjectId: string;
    readonly approvalId: string;
    readonly missionId: string;
    readonly approved: boolean;
  }): Promise<'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL' | null>;
}

export type TelegramWebhookResult =
  | { readonly outcome: 'RESOLVED'; readonly status: 'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL' }
  | { readonly outcome: 'IGNORED_UNLINKED_USER' }
  | { readonly outcome: 'IGNORED_MALFORMED_DATA' }
  | { readonly outcome: 'IGNORED_APPROVAL_NOT_FOUND' }
  | { readonly outcome: 'DENIED_SELF_APPROVAL' };

const CALLBACK_DATA_PATTERN = /^(approve|reject):([^:]+):([^:]+)$/u;

/**
 * Pure handling of one Telegram callback_query update -- no HTTP, no direct
 * database access. The caller (the actual webhook route) supplies real
 * Postgres-backed ports; tests supply fakes. Approval resolution always goes
 * through the same ChiefOfStaffOrchestrator.resolveApproval() path the Web
 * approval routes use, so the Phase 0 self-approval guard applies identically
 * here -- there is no separate, weaker approval path for Telegram.
 */
export async function handleTelegramCallbackQuery(
  update: TelegramCallbackUpdate,
  ports: {
    readonly linkResolver: TelegramLinkResolver;
    readonly approvalPort: ApprovalResolutionPort;
  },
): Promise<TelegramWebhookResult> {
  const match = CALLBACK_DATA_PATTERN.exec(update.data);
  if (!match) {
    return { outcome: 'IGNORED_MALFORMED_DATA' };
  }
  const approved = match[1] === 'approve';
  const approvalId = match[2] as string;
  const missionId = match[3] as string;

  const link = await ports.linkResolver.resolveSubject(update.telegramUserId);
  if (!link) {
    return { outcome: 'IGNORED_UNLINKED_USER' };
  }

  try {
    const status = await ports.approvalPort.resolve({
      tenantId: link.tenantId,
      approverSubjectId: link.subjectId,
      approvalId,
      missionId,
      approved,
    });
    if (status === null) {
      return { outcome: 'IGNORED_APPROVAL_NOT_FOUND' };
    }
    return { outcome: 'RESOLVED', status };
  } catch (err) {
    if (err instanceof ChiefOfStaffApprovalError && err.code === 'AGENT_SELF_APPROVAL_DENIED') {
      return { outcome: 'DENIED_SELF_APPROVAL' };
    }
    throw err;
  }
}
