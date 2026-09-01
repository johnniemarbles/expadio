import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  grantTenantMembership,
  listTenantMemberships,
  setTenantMembershipStatus,
} from '../lib/tenant-access';

function pool(){return new pg.Pool({
  host:process.env.PGHOST??'localhost',port:Number(process.env.PGPORT??5432),
  user:process.env.PGUSER??'postgres',password:process.env.PGPASSWORD??'postgres',
  database:process.env.PGDATABASE??'expadio_test',max:1,
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

    await c.query('BEGIN');
    const granted=await grantTenantMembership(c,{
      tenantId,organizationId:orgId,subjectId,issuer:'https://clerk.expadio.com',
      roleKey:'TENANT_ADMIN',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(granted.status,'ACTIVE');
    assert.deepEqual(granted.roleKeys,['TENANT_ADMIN']);

    await c.query('BEGIN');
    const suspended=await setTenantMembershipStatus(c,{
      tenantId,organizationId:orgId,membershipId:granted.membershipId,
      status:'SUSPENDED',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(suspended.status,'SUSPENDED');

    await c.query('BEGIN');
    const restored=await setTenantMembershipStatus(c,{
      tenantId,organizationId:orgId,membershipId:granted.membershipId,
      status:'ACTIVE',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(restored.status,'ACTIVE');

    await c.query('BEGIN');
    const revoked=await setTenantMembershipStatus(c,{
      tenantId,organizationId:orgId,membershipId:granted.membershipId,
      status:'REVOKED',actorSubjectId:'platform-admin',correlationId:randomUUID(),
    });
    await c.query('COMMIT');
    assert.equal(revoked.status,'REVOKED');

    const listed=await listTenantMemberships(c,{tenantId,organizationId:orgId});
    assert.equal(listed.length,1);

    const events=await c.query(`SELECT event_type,count(*)::int count FROM platform.domain_events
      WHERE tenant_id=$1 AND aggregate_type='tenant.access'
      GROUP BY event_type ORDER BY event_type`,[tenantId]);
    assert.deepEqual(events.rows,[
      {event_type:'tenant.membership.active',count:1},
      {event_type:'tenant.membership.granted',count:1},
      {event_type:'tenant.membership.revoked',count:1},
      {event_type:'tenant.membership.suspended',count:1},
    ]);
  }finally{try{await c.query('ROLLBACK')}catch{}c.release();await p.end()}
});
