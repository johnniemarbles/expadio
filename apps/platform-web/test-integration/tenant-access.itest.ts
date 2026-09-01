import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { listActiveMembershipWorkspaces } from '@expadio/postgres-runtime';
import {
  grantTenantMembership,
  listTenantMemberships,
  setTenantMembershipStatus,
  findTenantAccessInvitation,
  listPendingTenantAccessInvitations,
  recordTenantInvitation,
  setTenantAccessInvitationStatus,
  upsertTenantAccessInvitation,
} from '../lib/tenant-access';

function pool(){return new pg.Pool({
  host:process.env.PGHOST??'localhost',port:Number(process.env.PGPORT??5432),
  user:process.env.PGUSER??'postgres',password:process.env.PGPASSWORD??'postgres',
  database:process.env.PGDATABASE??'expadio_test',max:2,
})}

test('Platform membership grant -> suspend -> restore -> revoke is durable and audited',async()=>{
  const p=pool();const c=await p.connect();
  const tenantId=randomUUID(),orgId=randomUUID(),subjectId='user-'+randomUUID();
  try{
    await c.query(`INSERT INTO platform.tenants(tenant_id,name)VALUES($1,'Access tenant')`,[tenantId]);
    await c.query(`INSERT INTO platform.organizations(organization_id,tenant_id,name)VALUES($1,$2,'Access org')`,[orgId,tenantId]);
    await c.query(`SELECT set_config('app.tenant_id',$1,false)`,[tenantId]);
    await c.query(`INSERT INTO platform.authorization_roles(role_key,display_name,ownership_scope,tenant_id)
      VALUES('TENANT_ADMIN','Tenant Admin','TENANT',$1)`,[tenantId]);
    const platformRoleKey='PLATFORM_ACCESS_TEST_'+randomUUID().replaceAll('-','');
    const platformRole=await c.query<{role_id:string}>(`
      INSERT INTO platform.authorization_roles(role_key,display_name,ownership_scope,tenant_id)
      VALUES($1,'Platform access test','PLATFORM',NULL)
      RETURNING role_id`,[platformRoleKey]);

    await c.query('BEGIN');
    const granted=await grantTenantMembership(c,{
      tenantId,organizationId:orgId,subjectId,issuer:'https://clerk.expadio.com',
      roleKey:'TENANT_ADMIN',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(granted.status,'ACTIVE');
    assert.deepEqual(granted.roleKeys,['TENANT_ADMIN']);
    await c.query(`INSERT INTO platform.authorization_assignments
      (tenant_id,organization_id,subject_id,role_id,status)
      VALUES($1,$2,$3,$4,'ACTIVE')`,
      [tenantId,orgId,subjectId,platformRole.rows[0]!.role_id]);

    const visibleAfterGrant=await listActiveMembershipWorkspaces(p,{
      subjectId,actorKind:'user',issuer:'https://clerk.expadio.com',
    });
    assert.equal(visibleAfterGrant.length,1);
    assert.equal(visibleAfterGrant[0]?.tenantId,tenantId);
    assert.equal(visibleAfterGrant[0]?.organizationId,orgId);

    await c.query('BEGIN');
    const suspended=await setTenantMembershipStatus(c,{
      tenantId,organizationId:orgId,membershipId:granted.membershipId,
      status:'SUSPENDED',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(suspended.status,'SUSPENDED');
    assert.deepEqual(suspended.roleKeys,['TENANT_ADMIN']);
    assert.equal((await listActiveMembershipWorkspaces(p,{
      subjectId,actorKind:'user',issuer:'https://clerk.expadio.com',
    })).length,0);
    const suspendedAssignments=await c.query(`
      SELECT r.ownership_scope,a.status
        FROM platform.authorization_assignments a
        JOIN platform.authorization_roles r ON r.role_id=a.role_id
       WHERE a.tenant_id=$1 AND a.organization_id=$2 AND a.subject_id=$3
       ORDER BY r.ownership_scope`,[tenantId,orgId,subjectId]);
    assert.deepEqual(suspendedAssignments.rows,[
      {ownership_scope:'PLATFORM',status:'ACTIVE'},
      {ownership_scope:'TENANT',status:'SUSPENDED'},
    ]);

    await c.query('BEGIN');
    const restored=await setTenantMembershipStatus(c,{
      tenantId,organizationId:orgId,membershipId:granted.membershipId,
      status:'ACTIVE',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(restored.status,'ACTIVE');
    assert.deepEqual(restored.roleKeys,['TENANT_ADMIN']);
    assert.equal((await listActiveMembershipWorkspaces(p,{
      subjectId,actorKind:'user',issuer:'https://clerk.expadio.com',
    })).length,1);

    await c.query('BEGIN');
    await setTenantMembershipStatus(c,{
      tenantId,organizationId:orgId,membershipId:granted.membershipId,
      status:'SUSPENDED',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');

    await c.query('BEGIN');
    const revoked=await setTenantMembershipStatus(c,{
      tenantId,organizationId:orgId,membershipId:granted.membershipId,
      status:'REVOKED',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(revoked.status,'REVOKED');
    assert.deepEqual(revoked.roleKeys,['TENANT_ADMIN']);
    assert.equal((await listActiveMembershipWorkspaces(p,{
      subjectId,actorKind:'user',issuer:'https://clerk.expadio.com',
    })).length,0);
    const revokedAssignments=await c.query(`
      SELECT r.ownership_scope,a.status
        FROM platform.authorization_assignments a
        JOIN platform.authorization_roles r ON r.role_id=a.role_id
       WHERE a.tenant_id=$1 AND a.organization_id=$2 AND a.subject_id=$3
       ORDER BY r.ownership_scope`,[tenantId,orgId,subjectId]);
    assert.deepEqual(revokedAssignments.rows,[
      {ownership_scope:'PLATFORM',status:'ACTIVE'},
      {ownership_scope:'TENANT',status:'REVOKED'},
    ]);

    await c.query('BEGIN');
    const regranted=await grantTenantMembership(c,{
      tenantId,organizationId:orgId,subjectId,issuer:'https://clerk.expadio.com',
      roleKey:'TENANT_ADMIN',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(regranted.status,'ACTIVE');
    assert.notEqual(regranted.membershipId,granted.membershipId);
    assert.equal((await listActiveMembershipWorkspaces(p,{
      subjectId,actorKind:'user',issuer:'https://clerk.expadio.com',
    })).length,1);

    const listed=await listTenantMemberships(c,{tenantId,organizationId:orgId});
    assert.equal(listed.length,2);

    const events=await c.query(`SELECT event_type,count(*)::int count FROM platform.domain_events
      WHERE tenant_id=$1 AND aggregate_type='tenant.access'
      GROUP BY event_type ORDER BY event_type`,[tenantId]);
    assert.deepEqual(events.rows,[
      {event_type:'tenant.membership.active',count:1},
      {event_type:'tenant.membership.granted',count:2},
      {event_type:'tenant.membership.revoked',count:1},
      {event_type:'tenant.membership.suspended',count:2},
    ]);
  }finally{try{await c.query('ROLLBACK')}catch{}c.release();await p.end()}
});


test('Clerk-style invitation ids append tenant access audit event and outbox row',async()=>{
  const p=pool();const c=await p.connect();
  const tenantId=randomUUID(),orgId=randomUUID();
  const invitationId=`inv_${randomUUID().replaceAll('-','')}`;
  const correlationId=randomUUID();
  try{
    await c.query(`INSERT INTO platform.tenants(tenant_id,name)VALUES($1,'Invite audit tenant')`,[tenantId]);
    await c.query(`INSERT INTO platform.organizations(organization_id,tenant_id,name)VALUES($1,$2,'Invite audit org')`,[orgId,tenantId]);
    await c.query(`SELECT set_config('app.tenant_id',$1,false)`,[tenantId]);
    await c.query('BEGIN');
    await recordTenantInvitation(c,{
      tenantId,organizationId:orgId,invitationId,roleKey:'TENANT_ADMIN',
      actorSubjectId:'platform-admin',correlationId,
    });
    await c.query('COMMIT');

    const event=await c.query(`SELECT event_id,aggregate_id,event_type,correlation_id
      FROM platform.domain_events
      WHERE tenant_id=$1 AND aggregate_type='tenant.access' AND aggregate_id=$2`,
      [tenantId,invitationId]);
    assert.equal(event.rowCount,1);
    assert.equal(event.rows[0].event_type,'tenant.membership.invited');
    assert.equal(event.rows[0].correlation_id,correlationId);

    const outbox=await c.query(`SELECT o.status
      FROM platform.domain_event_outbox o
      JOIN platform.domain_events e ON e.event_id=o.event_id AND e.tenant_id=o.tenant_id
      WHERE e.tenant_id=$1 AND e.aggregate_id=$2`,[tenantId,invitationId]);
    assert.equal(outbox.rowCount,1);
    assert.equal(outbox.rows[0].status,'PENDING');
  }finally{try{await c.query('ROLLBACK')}catch{}c.release();await p.end()}
});


test('tenant invitation audit accepts PostgreSQL UUID tenant ids without RFC version bits',async()=>{
  const p=pool();const c=await p.connect();
  const tenantId='00000000-0000-0000-0000-00000000f501';
  const orgId='00000000-0000-0000-0000-00000000f502';
  const invitationId=`inv_${randomUUID().replaceAll('-','')}`;
  try{
    await c.query(`INSERT INTO platform.tenants(tenant_id,name)VALUES($1,'Postgres UUID tenant')`,[tenantId]);
    await c.query(`INSERT INTO platform.organizations(organization_id,tenant_id,name)VALUES($1,$2,'Postgres UUID org')`,[orgId,tenantId]);
    await c.query(`SELECT set_config('app.tenant_id',$1,false)`,[tenantId]);
    await c.query('BEGIN');
    await recordTenantInvitation(c,{
      tenantId,organizationId:orgId,invitationId,roleKey:'TENANT_ADMIN',
      actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    const persisted=await c.query(`
      SELECT aggregate_id,event_type FROM platform.domain_events
       WHERE tenant_id=$1::uuid AND aggregate_id=$2`,[tenantId,invitationId]);
    assert.equal(persisted.rowCount,1);
    assert.equal(persisted.rows[0].event_type,'tenant.membership.invited');
  }finally{try{await c.query('ROLLBACK')}catch{}c.release();await p.end()}
});


test('pending invitation registry survives unrelated membership suspension and revoke is durable',async()=>{
  const p=pool();const c=await p.connect();
  const tenantId=randomUUID(),orgId=randomUUID(),subjectId='member-'+randomUUID();
  const invitationId=`inv_${randomUUID().replaceAll('-','')}`;
  try{
    await c.query(`INSERT INTO platform.tenants(tenant_id,name)VALUES($1,'Invite registry tenant')`,[tenantId]);
    await c.query(`INSERT INTO platform.organizations(organization_id,tenant_id,name)VALUES($1,$2,'Invite registry org')`,[orgId,tenantId]);
    await c.query(`SELECT set_config('app.tenant_id',$1,false)`,[tenantId]);
    await c.query(`INSERT INTO platform.authorization_roles(role_key,display_name,ownership_scope,tenant_id)
      VALUES('TENANT_ADMIN','Tenant Admin','TENANT',$1)`,[tenantId]);

    await c.query('BEGIN');
    const member=await grantTenantMembership(c,{
      tenantId,organizationId:orgId,subjectId,issuer:'https://clerk.expadio.com',
      roleKey:'TENANT_ADMIN',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await upsertTenantAccessInvitation(c,{
      tenantId,organizationId:orgId,invitationId,email:'pending@example.test',
      roleKey:'TENANT_ADMIN',invitedBySubjectId:'platform-admin',correlationId:randomUUID(),
      clerkCreatedAt:new Date(),
    });
    await c.query('COMMIT');

    assert.equal((await listPendingTenantAccessInvitations(c,{tenantId,organizationId:orgId})).length,1);

    await c.query('BEGIN');
    await setTenantMembershipStatus(c,{
      tenantId,organizationId:orgId,membershipId:member.membershipId,status:'SUSPENDED',
      actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');

    assert.equal((await listPendingTenantAccessInvitations(c,{tenantId,organizationId:orgId})).length,1);

    await c.query('BEGIN');
    await setTenantAccessInvitationStatus(c,{
      tenantId,organizationId:orgId,invitationId,status:'REVOKED',
    });
    await c.query('COMMIT');

    assert.equal((await listPendingTenantAccessInvitations(c,{tenantId,organizationId:orgId})).length,0);
    assert.equal((await findTenantAccessInvitation(c,{tenantId,organizationId:orgId,invitationId}))?.status,'REVOKED');
  }finally{try{await c.query('ROLLBACK')}catch{}c.release();await p.end()}
});
