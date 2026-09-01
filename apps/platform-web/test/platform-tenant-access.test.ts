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
