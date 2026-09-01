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
    await client.query('BEGIN');await client.query("SELECT set_config('app.tenant_id',$1,true)",[context.tenantId]);
    const value=await work(client);await client.query('COMMIT');return value;
  }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}finally{client.release()}
}

export async function hasLearningAdmin(client:pg.PoolClient,subjectId:string):Promise<boolean>{
  const result=await client.query(
    `SELECT 1 FROM platform.authorization_assignments a
       JOIN platform.authorization_roles r ON r.role_id=a.role_id
      WHERE a.subject_id=$1 AND a.status='ACTIVE' AND r.status='ACTIVE'
        AND r.role_key=ANY($2::text[]) AND (a.valid_until IS NULL OR a.valid_until>now()) LIMIT 1`,
    [subjectId,['TENANT_OWNER','TENANT_ADMIN','PLATFORM_SUPER_ADMIN','PLATFORM_ADMIN']]);
  return result.rows.length>0;
}

export const brandWorkspaceCookieNames={tenant:TENANT_COOKIE,organization:ORG_COOKIE} as const;
