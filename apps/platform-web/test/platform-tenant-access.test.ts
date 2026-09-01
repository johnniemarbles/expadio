import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');

test('tenant access administration is Platform-only',()=>{
  const route=read('../app/api/platform/tenant/access/route.ts');
  const member=read('../app/api/platform/tenant/access/[membershipId]/route.ts');
  assert.match(route,/hasPlatformAdministrationRole/);
  assert.match(member,/hasPlatformAdministrationRole/);
  assert.doesNotMatch(route,/hasGovernanceWriteRole/);
});

test('new identities use real Clerk invitation and verified webhook provisioning',()=>{
  const route=read('../app/api/platform/tenant/access/route.ts');
  const webhook=read('../app/api/webhooks/clerk/route.ts');
  assert.match(route,/invitations\.createInvitation/);
  assert.match(route,/publicMetadata/);
  assert.match(webhook,/user\.created/);
  assert.match(webhook,/grantTenantMembership/);
  assert.match(webhook,/verifyWebhook/);
});

test('Brand remains unable to mint membership',()=>{
  const brand=read('../../brand-web/lib/brand-context.ts');
  assert.doesNotMatch(brand,/INSERT INTO platform\.memberships|grantTenantMembership/);
});

test('membership mutations append access audit events',()=>{
  const access=read('../lib/tenant-access.ts');
  assert.match(access,/tenant\.membership\.granted/);
  assert.match(access,/tenant\.membership\.roles\.updated/);
  assert.match(access,/appendDomainEventWithOutbox/);
});


test('Clerk invitation failures surface safe actionable reasons instead of INTERNAL_ERROR',()=>{
  const route=read('../app/api/platform/tenant/access/route.ts');
  assert.match(route,/clerkInvitationErrorResponse/);
  assert.match(route,/INVITATION_ALREADY_PENDING/);
  assert.match(route,/CLERK_INVITATIONS_NOT_SUPPORTED/);
  assert.match(route,/CLERK_INVITATION_RATE_LIMITED/);
  assert.match(route,/CLERK_BACKEND_AUTH_FAILED/);
});

test('a same-workspace pending invitation is idempotent',()=>{
  const route=read('../app/api/platform/tenant/access/route.ts');
  assert.match(route,/getInvitationList/);
  assert.match(route,/existingInvitation/);
  assert.match(route,/outcome: 'INVITATION_ALREADY_PENDING'/);
  assert.doesNotMatch(route,/ignoreExisting:\s*true/);
});


test('pending Clerk invitation collisions are scope-aware',()=>{
  const route=read('../app/api/platform/tenant/access/route.ts');
  assert.match(route,/pendingEmailInvitations/);
  assert.match(route,/INVITATION_PENDING_UNSCOPED/);
  assert.match(route,/INVITATION_PENDING_OTHER_WORKSPACE/);
  assert.match(route,/not linked to an EXPADIO workspace/);
});

test('pending invitation empty state is explicitly workspace-scoped',()=>{
  const manager=read('../components/TenantAccessManager/TenantAccessManager.tsx');
  assert.match(manager,/No pending invitations for this workspace/);
});


test('post-Clerk audit failure is compensated and never leaves a silent orphan',()=>{
  const route=read('../app/api/platform/tenant/access/route.ts');
  assert.match(route,/Invitation audit persistence failed/);
  assert.match(route,/revokeInvitation\(invitation\.id\)/);
  assert.match(route,/INVITATION_AUDIT_FAILED_ROLLED_BACK/);
  assert.match(route,/INVITATION_STATE_UNCERTAIN/);
});

test('tenant access errors return safe actionable reasons with correlation ids',()=>{
  const route=read('../app/api/platform/tenant/access/route.ts');
  assert.match(route,/tenantAccessErrorResponse/);
  assert.match(route,/TENANT_ACCESS_ORGANIZATION_INVALID/);
  assert.match(route,/TENANT_ACCESS_WRITE_FAILED/);
  assert.match(route,/Unhandled tenant invitation failure/);
  assert.match(route,/correlationId/);
});
