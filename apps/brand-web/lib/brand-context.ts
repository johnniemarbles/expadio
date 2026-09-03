import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import pg from 'pg';
import { listActiveMembershipWorkspaces } from '@expadio/postgres-runtime';

const ISSUER = 'https://clerk.expadio.com';
const TENANT_COOKIE = 'expadio-brand-tenant';
const ORG_COOKIE = 'expadio-brand-org';

declare global { var _brandDbPool: pg.Pool | undefined; }

export const dbPool = global._brandDbPool ?? new pg.Pool(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'expadio',
    password: process.env.PGPASSWORD || 'expadio_password',
    database: process.env.PGDATABASE || 'expadio',
  },
);
if (process.env.NODE_ENV === 'development') global._brandDbPool = dbPool;


export interface BrandWorkspaceOption {
  readonly tenantId:string;readonly tenantName:string;readonly organizationId:string;readonly organizationName:string;
}
export interface BrandContext extends BrandWorkspaceOption {
  readonly subjectId:string;readonly issuer:string;readonly workspaces:readonly BrandWorkspaceOption[];
}
export class BrandContextError extends Error {
  readonly code:'UNAUTHENTICATED'|'NO_BRAND_MEMBERSHIP';
  constructor(code:BrandContextError['code']){super(code);this.name='BrandContextError';this.code=code}
}

async function activeWorkspaces(subjectId:string):Promise<BrandWorkspaceOption[]>{
  return [...await listActiveMembershipWorkspaces(dbPool,{
    subjectId,actorKind:'user',issuer:ISSUER,
  })];
}

export async function resolveBrandContext():Promise<BrandContext>{
  const {userId}=await auth();if(!userId)throw new BrandContextError('UNAUTHENTICATED');
  const workspaces=await activeWorkspaces(userId);if(workspaces.length===0)throw new BrandContextError('NO_BRAND_MEMBERSHIP');
  const jar=await cookies();const selectedTenant=jar.get(TENANT_COOKIE)?.value;const selectedOrg=jar.get(ORG_COOKIE)?.value;
  const selected=workspaces.find((entry)=>entry.tenantId===selectedTenant&&entry.organizationId===selectedOrg)??workspaces[0];
  if(!selected)throw new BrandContextError('NO_BRAND_MEMBERSHIP');
  return {subjectId:userId,issuer:ISSUER,...selected,workspaces};
}

export async function withBrandTransaction<T>(context:BrandContext,work:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
  const client=await dbPool.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true),
              set_config('app.subject_id',$2,true),
              set_config('app.issuer',$3,true),
              set_config('app.organization_id',$4,true)`,
      [context.tenantId,context.subjectId,context.issuer,context.organizationId],
    );
    const value=await work(client);await client.query('COMMIT');return value;
  }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}finally{client.release()}
}

export async function hasBrandAdministrationRole(client:pg.PoolClient,subjectId:string):Promise<boolean>{
  const result=await client.query(
    `SELECT 1 FROM platform.authorization_assignments a
       JOIN platform.authorization_roles r ON r.role_id=a.role_id
      WHERE a.subject_id=$1 AND a.status='ACTIVE' AND r.status='ACTIVE'
        AND r.role_key=ANY($2::text[])
        AND a.valid_from<=now()
        AND (a.valid_until IS NULL OR a.valid_until>now()) LIMIT 1`,
    [subjectId,['TENANT_OWNER','TENANT_ADMIN','PLATFORM_SUPER_ADMIN','PLATFORM_ADMIN']]);
  return result.rows.length>0;
}

export async function hasLearningAdmin(client:pg.PoolClient,subjectId:string):Promise<boolean>{
  return hasBrandAdministrationRole(client,subjectId);
}

const BRAND_GOVERNANCE_ROLES = [
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'PLATFORM_SUPER_ADMIN',
  'PLATFORM_ADMIN',
] as const;

export async function hasBrandGovernanceForOrganization(
  client: pg.PoolClient,
  subjectId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM platform.authorization_assignments assignment
       JOIN platform.authorization_roles role
         ON role.role_id = assignment.role_id
      WHERE assignment.subject_id = $1
        AND assignment.status = 'ACTIVE'
        AND role.status = 'ACTIVE'
        AND role.role_key = ANY($2::text[])
        AND assignment.valid_from <= now()
        AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
        AND (
          assignment.organization_id IS NULL
          OR assignment.organization_id = $3::uuid
        )
        AND (
          assignment.action_organization_ids IS NULL
          OR $3::uuid = ANY(assignment.action_organization_ids)
        )
      LIMIT 1`,
    [subjectId, BRAND_GOVERNANCE_ROLES, organizationId],
  );
  return result.rows.length > 0;
}



export type BrandAccessDiagnosticReason =
  | 'NO_MATCHING_MEMBERSHIP'
  | 'MEMBERSHIP_SUSPENDED'
  | 'MEMBERSHIP_REVOKED'
  | 'MEMBERSHIP_EXPIRED'
  | 'ACTIVE_MEMBERSHIP_NOT_RESOLVED';

export interface BrandAccessDiagnostic {
  readonly subjectId:string;
  readonly issuer:string;
  readonly reason:BrandAccessDiagnosticReason;
  readonly membershipId:string|null;
  readonly tenantId:string|null;
  readonly organizationId:string|null;
  readonly status:'ACTIVE'|'SUSPENDED'|'REVOKED'|null;
  readonly validUntil:string|null;
}

export async function diagnoseBrandAccess():Promise<BrandAccessDiagnostic|null>{
  const {userId}=await auth();
  if(!userId)return null;
  const client=await dbPool.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.subject_id',$1,true),
              set_config('app.issuer',$2,true)`,
      [userId,ISSUER],
    );
    const result=await client.query<{
      membership_id:string;tenant_id:string;organization_id:string;
      status:'ACTIVE'|'SUSPENDED'|'REVOKED';valid_until:Date|string|null;
    }>(
      `SELECT membership_id,tenant_id,organization_id,status,valid_until
         FROM platform.memberships
        WHERE subject_id=$1
          AND issuer IS NOT DISTINCT FROM $2
        ORDER BY updated_at DESC
        LIMIT 1`,
      [userId,ISSUER],
    );
    await client.query('COMMIT');
    const row=result.rows[0];
    if(!row){
      return {
        subjectId:userId,issuer:ISSUER,reason:'NO_MATCHING_MEMBERSHIP',
        membershipId:null,tenantId:null,organizationId:null,status:null,validUntil:null,
      };
    }
    const validUntil=row.valid_until===null?null:(row.valid_until instanceof Date?row.valid_until:new Date(row.valid_until)).toISOString();
    const expired=validUntil!==null&&new Date(validUntil).getTime()<=Date.now();
    const reason:BrandAccessDiagnosticReason =
      row.status==='SUSPENDED'?'MEMBERSHIP_SUSPENDED'
      :row.status==='REVOKED'?'MEMBERSHIP_REVOKED'
      :expired?'MEMBERSHIP_EXPIRED'
      :'ACTIVE_MEMBERSHIP_NOT_RESOLVED';
    return {
      subjectId:userId,issuer:ISSUER,reason,
      membershipId:row.membership_id,tenantId:row.tenant_id,organizationId:row.organization_id,
      status:row.status,validUntil,
    };
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    throw error;
  }finally{
    client.release();
  }
}

export const brandWorkspaceCookieNames={tenant:TENANT_COOKIE,organization:ORG_COOKIE} as const;
