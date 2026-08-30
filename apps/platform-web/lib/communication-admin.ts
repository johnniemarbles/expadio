import {
  ContextDenied,
  withTenantTransaction,
  type ResolvedRequestContext,
} from './request-context';
import { hasPlatformCommunicationAuthority } from './platform-communication-authority.ts';

export async function requireCommunicationAdmin(context: ResolvedRequestContext): Promise<void> {
  const allowed = await withTenantTransaction(context, (client) =>
    hasPlatformCommunicationAuthority(client, context));
  if (!allowed) {
    throw new ContextDenied(
      'PLATFORM_COMMUNICATION_ADMIN_REQUIRED',
      'Providers are managed by the platform. Brands configure their communication channels and senders.',
      403,
    );
  }
}
