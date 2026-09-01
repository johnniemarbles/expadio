'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './TenantAccessManager.module.css';

type Member = {
  membershipId:string;subjectId:string;status:'ACTIVE'|'SUSPENDED'|'REVOKED';
  validUntil:string|null;roleKeys:string[];
  identity:{name:string|null;email:string|null;imageUrl:string|null};
};
type Invitation = {invitationId:string;email:string;roleKey:string|null;status:string;createdAt:string};

function label(value:string){return value.toLowerCase().replaceAll('_',' ').replace(/\b\w/g,(x)=>x.toUpperCase())}

export function TenantAccessManager({
  accountId,organizationId,members,invitations,roleKeys,
}:{
  accountId:string;organizationId:string;members:Member[];invitations:Invitation[];roleKeys:string[];
}){
  const router=useRouter();
  const [email,setEmail]=useState('');
  const [roleKey,setRoleKey]=useState(roleKeys.includes('TENANT_ADMIN')?'TENANT_ADMIN':roleKeys[0]??'');
  const [validUntil,setValidUntil]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [memberRows,setMemberRows]=useState<Member[]>(members);
  useEffect(()=>setMemberRows(members),[members]);
  const query=useMemo(()=>new URLSearchParams({account:accountId,org:organizationId}).toString(),[accountId,organizationId]);

  async function invite(event:React.FormEvent){
    event.preventDefault();setBusy('invite');setError(null);
    try{
      const res=await fetch(`/api/platform/tenant/access?${query}`,{
        method:'POST',headers:{'content-type':'application/json','x-correlation-id':crypto.randomUUID()},
        body:JSON.stringify({email,roleKey,validUntil:validUntil?new Date(validUntil).toISOString():null}),
      });
      const payload=await res.json();
      if(!res.ok)throw new Error(payload.message??payload.reasonKey??'Access grant failed.');
      setEmail('');setValidUntil('');router.refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'Access grant failed.')}finally{setBusy(null)}
  }

  async function patch(member:Member,body:Record<string,unknown>,key:string){
    setBusy(key);setError(null);
    try{
      const res=await fetch(`/api/platform/tenant/access/${encodeURIComponent(member.membershipId)}?${query}`,{
        method:'PATCH',headers:{'content-type':'application/json','x-correlation-id':crypto.randomUUID()},
        body:JSON.stringify(body),
      });
      const payload=await res.json();
      if(!res.ok)throw new Error(payload.message??payload.reasonKey??'Access update failed.');
      if(payload.membership){
        setMemberRows(rows=>rows.map(row=>row.membershipId===member.membershipId
          ?{...row,...payload.membership,identity:row.identity}
          :row));
      }
      router.refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'Access update failed.')}finally{setBusy(null)}
  }

  async function revokeInvite(invitationId:string){
    if(!confirm('Revoke this pending invitation?'))return;
    setBusy(invitationId);setError(null);
    try{
      const res=await fetch(`/api/platform/tenant/access/invitations/${encodeURIComponent(invitationId)}/revoke?${query}`,{
        method:'POST',headers:{'x-correlation-id':crypto.randomUUID()},
      });
      if(!res.ok){const p=await res.json();throw new Error(p.message??'Invitation revoke failed.')}
      router.refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'Invitation revoke failed.')}finally{setBusy(null)}
  }

  return <div className={styles.stack}>
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2>Add tenant user</h2><p>Existing Clerk users are granted immediately. New identities receive a real Clerk invitation.</p></div></div>
      <form className={styles.form} onSubmit={invite}>
        <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="user@company.com"/></label>
        <label>Role<select value={roleKey} onChange={e=>setRoleKey(e.target.value)}>{roleKeys.map(r=><option key={r} value={r}>{label(r)}</option>)}</select></label>
        <label>Access expires<input type="datetime-local" value={validUntil} onChange={e=>setValidUntil(e.target.value)}/></label>
        <button type="submit" disabled={busy!==null}>{busy==='invite'?'Working…':'Grant or invite'}</button>
      </form>
      {error?<div className={styles.error} role="alert">{error}</div>:null}
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2>Active directory</h2><p>{members.length} membership record{members.length===1?'':'s'} in this organization.</p></div></div>
      <div className={styles.tableWrap}><table><thead><tr><th>User</th><th>Roles</th><th>Status</th><th>Expiry</th><th>Actions</th></tr></thead><tbody>
        {memberRows.map(member=><tr key={member.membershipId}>
          <td><strong>{member.identity.name??member.identity.email??member.subjectId}</strong><span>{member.identity.email??member.subjectId}</span></td>
          <td><select value={member.roleKeys[0]??''} disabled={member.status!=='ACTIVE'||busy!==null} onChange={e=>void patch(member,{roleKeys:[e.target.value]},`role:${member.membershipId}`)}><option value="" disabled>Select role</option>{roleKeys.map(r=><option key={r} value={r}>{label(r)}</option>)}</select></td>
          <td><span className={styles.status}>{label(member.status)}</span></td>
          <td>{member.validUntil?new Date(member.validUntil).toLocaleString():'No expiry'}</td>
          <td className={styles.actions}>
            {member.status==='ACTIVE'?<button onClick={()=>void patch(member,{status:'SUSPENDED'},member.membershipId)} disabled={busy!==null}>Suspend</button>:null}
            {member.status==='SUSPENDED'?<button onClick={()=>void patch(member,{status:'ACTIVE'},member.membershipId)} disabled={busy!==null}>Restore</button>:null}
            {member.status!=='REVOKED'?<button className={styles.danger} onClick={()=>confirm('Permanently revoke this membership?')&&void patch(member,{status:'REVOKED'},member.membershipId)} disabled={busy!==null}>Revoke</button>:null}
          </td>
        </tr>)}
        {memberRows.length===0?<tr><td colSpan={5} className={styles.empty}>No memberships yet.</td></tr>:null}
      </tbody></table></div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2>Pending invitations</h2><p>Invitation acceptance provisions membership through the verified Clerk webhook.</p></div></div>
      <div className={styles.invites}>{invitations.length===0?<div className={styles.empty}>No pending invitations for this workspace.</div>:invitations.map(inv=><div className={styles.invite} key={inv.invitationId}><div><strong>{inv.email}</strong><span>{inv.roleKey?label(inv.roleKey):'Tenant role'} · sent {new Date(inv.createdAt).toLocaleString()}</span></div><button className={styles.danger} disabled={busy!==null} onClick={()=>void revokeInvite(inv.invitationId)}>{busy===inv.invitationId?'Revoking…':'Revoke invite'}</button></div>)}</div>
    </section>
  </div>
}
