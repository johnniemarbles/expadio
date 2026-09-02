"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import styles from './CommunicationsManager.module.css';

type TemplateRow = {
  templateId:string;version:number;triggerKey:string;channel:string;locale:string;
  subject:string|null;title:string|null;body:string;status:string;updatedAt:string;
};
type SenderRow = {
  senderId:string;address:string;domain:string;displayName:string|null;purposes:string[];
  isDefault:boolean;verificationStatus:string;status:string;
};
type SuppressionRow = {
  suppressionId:string;recipientKey:string;channel:string;reason:string;status:string;recordedAt:string;
};

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error || 'Request failed.');
  return data;
}

export function CommunicationsManager() {
  const [templates,setTemplates]=useState<TemplateRow[]>([]);
  const [senders,setSenders]=useState<SenderRow[]>([]);
  const [suppressions,setSuppressions]=useState<SuppressionRow[]>([]);
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);

  const reload=useCallback(async()=>{
    const [templateData,senderData,suppressionData]=await Promise.all([
      fetch('/api/communications/templates',{cache:'no-store'}).then(responseJson),
      fetch('/api/communications/senders',{cache:'no-store'}).then(responseJson),
      fetch('/api/communications/suppressions?status=ACTIVE&limit=100',{cache:'no-store'}).then(responseJson),
    ]);
    setTemplates(Array.isArray(templateData)?templateData:[]);
    setSenders(Array.isArray(senderData)?senderData:[]);
    setSuppressions(Array.isArray(suppressionData?.items)?suppressionData.items:[]);
  },[]);

  useEffect(()=>{reload().catch((cause)=>setError(cause instanceof Error?cause.message:'Unable to load communication controls.'));},[reload]);

  async function createTemplate(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy('template');setError(null);setNotice(null);
    const form=new FormData(event.currentTarget);
    try{
      await responseJson(await fetch('/api/communications/templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        triggerKey:String(form.get('triggerKey')||''),channel:String(form.get('channel')||'email'),locale:'en',
        contentFormat:String(form.get('contentFormat')||'TEXT'),subject:String(form.get('subject')||'')||null,
        body:String(form.get('body')||''),requiredVariables:[],defaultVariables:{},
      })}));
      event.currentTarget.reset();setNotice('Draft template created. Publication remains a separate governed step.');await reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not create template.');}finally{setBusy(null);}
  }

  async function createSender(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy('sender');setError(null);setNotice(null);
    const form=new FormData(event.currentTarget);
    try{
      await responseJson(await fetch('/api/communications/senders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        domain:String(form.get('domain')||''),address:String(form.get('address')||'')||undefined,
        displayName:String(form.get('displayName')||'')||undefined,purposes:[String(form.get('purpose')||'transactional')],
      })}));
      event.currentTarget.reset();setNotice('Sender registered as PENDING. It cannot become default until verification succeeds.');await reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not create sender.');}finally{setBusy(null);}
  }

  async function promoteSender(senderId:string){
    setBusy(senderId);setError(null);setNotice(null);
    try{
      await responseJson(await fetch('/api/communications/senders',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({senderId,isDefault:true})}));
      setNotice('Verified sender selected as the organization default.');await reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not select sender.');}finally{setBusy(null);}
  }

  async function retireSender(senderId:string){
    setBusy(senderId);setError(null);setNotice(null);
    try{
      await responseJson(await fetch(`/api/communications/senders/${encodeURIComponent(senderId)}`,{method:'DELETE'}));
      setNotice('Sender retired.');await reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not retire sender.');}finally{setBusy(null);}
  }

  async function createSuppression(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy('suppression');setError(null);setNotice(null);
    const form=new FormData(event.currentTarget);
    try{
      await responseJson(await fetch('/api/communications/suppressions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        recipientKey:String(form.get('recipientKey')||''),channel:String(form.get('channel')||'email'),reason:String(form.get('reason')||'OPT_OUT'),
      })}));
      event.currentTarget.reset();setNotice('Organization suppression recorded.');await reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not create suppression.');}finally{setBusy(null);}
  }

  async function revokeSuppression(suppressionId:string){
    setBusy(suppressionId);setError(null);setNotice(null);
    try{
      await responseJson(await fetch(`/api/communications/suppressions/${encodeURIComponent(suppressionId)}`,{method:'DELETE'}));
      setNotice('Organization suppression revoked; all other eligibility checks still apply.');await reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not revoke suppression.');}finally{setBusy(null);}
  }

  return <section className={styles.manager} aria-label="Brand communication controls">
    <div className={styles.managerHeader}><div><p className={styles.eyebrow}>Organization controls</p><h2>Messaging configuration</h2></div><button type="button" className={styles.secondary} onClick={()=>reload().catch(()=>{})}>Refresh</button></div>
    <p className={styles.boundary}>Manage organization content, sender identities, and suppressions here. Delivery infrastructure and verification evidence stay outside this workspace.</p>
    {error&&<div className={styles.error} role="alert">{error}</div>}
    {notice&&<div className={styles.notice} role="status">{notice}</div>}

    <div className={styles.columns}>
      <article className={styles.panel}>
        <h3>Template drafts</h3><p className={styles.help}>Create organization-owned drafts. This surface does not publish them.</p>
        <form className={styles.form} onSubmit={createTemplate}>
          <label>Trigger key<input name="triggerKey" required placeholder="appointment.reminder" /></label>
          <div className={styles.row}><label>Channel<select name="channel" defaultValue="email"><option>email</option><option>sms</option><option>whatsapp</option><option>voice</option><option>push</option><option>rcs</option></select></label><label>Format<select name="contentFormat" defaultValue="TEXT"><option>TEXT</option><option>HTML</option><option>MARKDOWN</option></select></label></div>
          <label>Subject<input name="subject" placeholder="Optional for non-email channels" /></label>
          <label>Body<textarea name="body" required rows={4} /></label>
          <button className={styles.primary} disabled={busy==='template'}>{busy==='template'?'Saving…':'Create draft'}</button>
        </form>
        <div className={styles.list}>{templates.slice(0,8).map((item)=><div className={styles.item} key={`${item.templateId}:${item.version}`}><div><strong>{item.triggerKey}</strong><small>{item.channel} · v{item.version} · {item.status}</small></div></div>)}{templates.length===0&&<p className={styles.empty}>No organization templates yet.</p>}</div>
      </article>

      <article className={styles.panel}>
        <h3>Sending identities</h3><p className={styles.help}>New identities start pending. Only an active verified identity can be selected as default.</p>
        <form className={styles.form} onSubmit={createSender}>
          <label>Domain<input name="domain" required placeholder="mail.example.com" /></label>
          <label>Address<input name="address" type="email" placeholder="notifications@mail.example.com" /></label>
          <label>Display name<input name="displayName" placeholder="Example notifications" /></label>
          <label>Purpose<select name="purpose" defaultValue="transactional"><option value="transactional">transactional</option><option value="marketing">marketing</option></select></label>
          <button className={styles.primary} disabled={busy==='sender'}>{busy==='sender'?'Saving…':'Register sender'}</button>
        </form>
        <div className={styles.list}>{senders.map((sender)=><div className={styles.item} key={sender.senderId}><div><strong>{sender.address}</strong><small>{sender.verificationStatus} · {sender.status}{sender.isDefault?' · DEFAULT':''}</small></div><div className={styles.actions}>{sender.status==='ACTIVE'&&sender.verificationStatus==='VERIFIED'&&!sender.isDefault&&<button className={styles.secondary} disabled={busy===sender.senderId} onClick={()=>promoteSender(sender.senderId)}>Make default</button>} {sender.status==='ACTIVE'&&<button className={styles.danger} disabled={busy===sender.senderId} onClick={()=>retireSender(sender.senderId)}>Retire</button>}</div></div>)}{senders.length===0&&<p className={styles.empty}>No organization senders yet.</p>}</div>
      </article>

      <article className={styles.panel}>
        <h3>Organization suppressions</h3><p className={styles.help}>These controls cannot alter inherited tenant or platform suppression state.</p>
        <form className={styles.form} onSubmit={createSuppression}>
          <label>Recipient<input name="recipientKey" required placeholder="person@example.com" /></label>
          <div className={styles.row}><label>Channel<select name="channel" defaultValue="email"><option>email</option><option>sms</option><option>whatsapp</option><option>voice</option><option>push</option><option>rcs</option></select></label><label>Reason<select name="reason" defaultValue="OPT_OUT"><option>OPT_OUT</option><option>UNSUBSCRIBE</option><option>BOUNCE</option><option>COMPLAINT</option><option>LEGAL_HOLD</option></select></label></div>
          <button className={styles.primary} disabled={busy==='suppression'}>{busy==='suppression'?'Saving…':'Add suppression'}</button>
        </form>
        <div className={styles.list}>{suppressions.map((item)=><div className={styles.item} key={item.suppressionId}><div><strong>{item.recipientKey}</strong><small>{item.channel} · {item.reason}</small></div><button className={styles.secondary} disabled={busy===item.suppressionId} onClick={()=>revokeSuppression(item.suppressionId)}>Revoke</button></div>)}{suppressions.length===0&&<p className={styles.empty}>No active organization suppressions.</p>}</div>
      </article>
    </div>
  </section>;
}
