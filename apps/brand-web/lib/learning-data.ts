import type { PoolClient } from 'pg';
import { listLearningCourses, loadLearningTenantContext, loadTenantProductModule, type LearningCourseSummary, type TenantProductModuleSummary } from '@expadio/postgres-runtime';

export interface LearningDashboard{readonly module:TenantProductModuleSummary|null;readonly academyName:string|null;readonly metrics:readonly {label:string;value:number;detail:string}[];readonly recentCourses:readonly LearningCourseSummary[]}
async function count(client:PoolClient,sql:string,tenantId:string){const result=await client.query<{value:number}>(sql,[tenantId]);return Number(result.rows[0]?.value??0)}
export async function loadLearningDashboard(client:PoolClient,tenantId:string):Promise<LearningDashboard>{
  const module=await loadTenantProductModule(client,{tenantId,moduleKey:'learning'});
  if(module?.availability!=='ACTIVE')return {module,academyName:null,metrics:[],recentCourses:[]};
  const context=await loadLearningTenantContext(client,tenantId);
  const [courses,learners,active,completed,overdue,programs,credentials]=await Promise.all([
    listLearningCourses(client,tenantId),
    count(client,"SELECT count(*)::int AS value FROM platform.learning_learners WHERE tenant_id=$1::uuid AND status='ACTIVE'",tenantId),
    count(client,"SELECT count(*)::int AS value FROM platform.learning_enrollments WHERE tenant_id=$1::uuid AND status IN ('ASSIGNED','IN_PROGRESS')",tenantId),
    count(client,"SELECT count(*)::int AS value FROM platform.learning_enrollments WHERE tenant_id=$1::uuid AND status='COMPLETED'",tenantId),
    count(client,"SELECT count(*)::int AS value FROM platform.learning_enrollments WHERE tenant_id=$1::uuid AND status IN ('ASSIGNED','IN_PROGRESS') AND due_at<now()",tenantId),
    count(client,"SELECT count(*)::int AS value FROM platform.learning_programs WHERE tenant_id=$1::uuid AND status='ACTIVE'",tenantId),
    count(client,"SELECT count(*)::int AS value FROM platform.learning_credentials WHERE tenant_id=$1::uuid AND status='ACTIVE'",tenantId),
  ]);
  return {module,academyName:context.settings.academyName,metrics:[
    {label:'Courses',value:courses.length,detail:'Draft and published catalog'},
    {label:'Active learners',value:learners,detail:'Learners able to progress'},
    {label:'In learning',value:active,detail:'Assigned or in progress'},
    {label:'Completed',value:completed,detail:'Completed enrollments'},
    {label:'Overdue',value:overdue,detail:'Past due and incomplete'},
    {label:'Programs',value:programs,detail:'Active learning programs'},
    {label:'Credentials',value:credentials,detail:'Active issued credentials'},
  ],recentCourses:courses.slice(0,6)};
}
