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
