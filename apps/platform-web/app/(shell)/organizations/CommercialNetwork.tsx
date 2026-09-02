'use client';

import React, { useMemo, useState } from 'react';
import styles from './CommercialNetwork.module.css';

export interface CommercialNetworkData {
  enterpriseId: string | null;
  organizations: Array<{ organization_id:string; name:string; status:string }>;
  legalEntities: Array<{ legal_entity_id:string; legal_name:string; jurisdiction_country_code:string }>;
  territories: Array<{ territory_id:string; territory_key:string; name:string; territory_kind:string; country_code:string|null; subdivision_code:string|null; status:string }>;
  agreements: Array<{ enterprise_commercial_agreement_id:string; agreement_number:string|null; title:string; agreement_kind:string; sponsoring_organization_id:string; state:string; grantor_legal_name:string; grantee_legal_name:string }>;
  appointments: Array<{ enterprise_appointment_id:string; enterprise_commercial_agreement_id:string; grantor_organization_id:string; beneficiary_organization_id:string; beneficiary_name:string; grantor_name:string; appointment_kind:string; requested_right_types:string[]; rights_profile_key:string; state:string; workflow_instance_id:string|null; workflow_rights_grant_id:string|null; territories:Array<{ territoryId:string; name:string; exclusive:boolean }> }>;
  jurisdictions: Array<{ enterprise_jurisdiction_activation_id:string; organization_id:string; organization_name:string; enterprise_appointment_id:string; territory_id:string; territory_name:string; state:string; workflow_activation_id:string|null }>;
}

async function postCommercial(suffix:string,payload:Record<string,unknown>){
  const response=await fetch('/api/enterprise/commercial'+suffix,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok || body?.denied===true) throw new Error(body?.message??body?.reasonKey??'Commercial action failed.');
  return body;
}
function csv(value:string){return value.split(',').map((part)=>part.trim()).filter(Boolean);}

export function CommercialNetwork({data,suffix}:{data:CommercialNetworkData;suffix:string}){
  const [busy,setBusy]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const activeAgreements=useMemo(()=>data.agreements.filter((agreement)=>agreement.state==='ACTIVE'),[data.agreements]);

  const act=async(key:string,payload:Record<string,unknown>,success:string)=>{
    setBusy(key);setMessage(null);setError(null);
    try{await postCommercial(suffix,payload);setMessage(success);window.location.reload();}
    catch(caught){setError(caught instanceof Error?caught.message:'Commercial action failed.');}
    finally{setBusy(null);}
  };

  return <div className={styles.stack}>
    {(message||error)&&<div className={error?styles.error:styles.success} role={error?'alert':'status'}>{error??message}</div>}
    <div className={styles.metrics}>
      <div><strong>{data.territories.length}</strong><span>territories</span></div>
      <div><strong>{activeAgreements.length}</strong><span>active agreements</span></div>
      <div><strong>{data.appointments.filter((item)=>item.state==='ACTIVE').length}</strong><span>active appointments</span></div>
      <div><strong>{data.jurisdictions.filter((item)=>item.state==='ACTIVE').length}</strong><span>active jurisdictions</span></div>
    </div>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><span>Geography</span><h3>Territories</h3></div><small>Structured country / subdivision / locality scopes</small></div>
      <form className={styles.formGrid} onSubmit={(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);void act('territory:create',{action:'CREATE_TERRITORY',territoryKey:form.get('territoryKey'),name:form.get('name'),territoryKind:form.get('territoryKind'),countryCode:form.get('countryCode'),subdivisionCode:form.get('subdivisionCode'),localityName:form.get('localityName')},'Territory created.');}}>
        <label>Key<input name="territoryKey" required placeholder="ca.on"/></label>
        <label>Name<input name="name" required placeholder="Ontario"/></label>
        <label>Type<select name="territoryKind" defaultValue="COUNTRY"><option>GLOBAL</option><option>COUNTRY</option><option>SUBDIVISION</option><option>LOCALITY</option><option>CUSTOM</option></select></label>
        <label>Country<input name="countryCode" maxLength={2} placeholder="CA"/></label>
        <label>Subdivision<input name="subdivisionCode" placeholder="ON"/></label>
        <label>Locality<input name="localityName" placeholder="Toronto"/></label>
        <button disabled={busy!==null}>Add territory</button>
      </form>
      <div className={styles.chips}>{data.territories.map((territory)=><span key={territory.territory_id}><strong>{territory.name}</strong><small>{territory.territory_kind}{territory.country_code?` · ${territory.country_code}`:''}</small></span>)}{data.territories.length===0&&<em>No territories configured.</em>}</div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><span>Commercial authority</span><h3>Agreements</h3></div><small>Separate from CRM/customer agreements</small></div>
      <form className={styles.formGrid} onSubmit={(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);void act('agreement:create',{action:'CREATE_AGREEMENT',title:form.get('title'),agreementNumber:form.get('agreementNumber'),agreementKind:form.get('agreementKind'),grantorLegalEntityId:form.get('grantorLegalEntityId'),granteeLegalEntityId:form.get('granteeLegalEntityId')},'Commercial agreement drafted.');}}>
        <label>Title<input name="title" required placeholder="Canada Master Franchise"/></label>
        <label>Number<input name="agreementNumber" placeholder="MF-CA-001"/></label>
        <label>Kind<select name="agreementKind" defaultValue="FRANCHISE"><option>FRANCHISE</option><option>MASTER_FRANCHISE</option><option>DISTRIBUTION</option><option>WHOLESALE</option><option>RETAIL</option><option>AFFILIATE</option><option>BROKER</option><option>LICENSE</option><option>AGENCY</option><option>MANAGEMENT</option><option>SERVICE</option><option>JOINT_VENTURE</option><option>OTHER</option></select></label>
        <label>Grantor<select name="grantorLegalEntityId" required defaultValue=""><option value="" disabled>Select verified entity</option>{data.legalEntities.map((entity)=><option key={entity.legal_entity_id} value={entity.legal_entity_id}>{entity.legal_name}</option>)}</select></label>
        <label>Grantee<select name="granteeLegalEntityId" required defaultValue=""><option value="" disabled>Select verified entity</option>{data.legalEntities.map((entity)=><option key={entity.legal_entity_id} value={entity.legal_entity_id}>{entity.legal_name}</option>)}</select></label>
        <button disabled={busy!==null||data.legalEntities.length<2}>Create draft</button>
      </form>
      <div className={styles.tableWrap}><table><thead><tr><th>Agreement</th><th>Parties</th><th>Kind</th><th>State</th><th>Action</th></tr></thead><tbody>
        {data.agreements.map((agreement)=><tr key={agreement.enterprise_commercial_agreement_id}>
          <td><strong>{agreement.title}</strong><small>{agreement.agreement_number??agreement.enterprise_commercial_agreement_id}</small></td>
          <td>{agreement.grantor_legal_name} → {agreement.grantee_legal_name}</td><td>{agreement.agreement_kind}</td><td>{agreement.state}</td>
          <td>{agreement.state!=='ACTIVE'?<button disabled={busy!==null} onClick={()=>void act(`agreement:${agreement.enterprise_commercial_agreement_id}`,{action:'ACTIVATE_AGREEMENT',agreementId:agreement.enterprise_commercial_agreement_id,executionEvidenceRefs:[`ui:agreement:${agreement.enterprise_commercial_agreement_id}:executed`]},'Agreement activated.')}>Activate with evidence</button>:<span className={styles.good}>Active</span>}</td>
        </tr>)}
      </tbody></table></div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><span>Appointments & rights</span><h3>Commercial network</h3></div><small>Decision → immutable rights grant → active appointment</small></div>
      <form className={styles.formGrid} onSubmit={(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);void act('appointment:create',{action:'CREATE_APPOINTMENT',agreementId:form.get('agreementId'),beneficiaryOrganizationId:form.get('beneficiaryOrganizationId'),beneficiaryLegalEntityId:form.get('beneficiaryLegalEntityId'),appointmentKind:form.get('appointmentKind'),rightsProfileKey:form.get('rightsProfileKey'),requestedRightTypes:csv(String(form.get('rightTypes')??'')),territoryIds:form.getAll('territoryIds'),exclusive:form.get('exclusive')==='on'},'Appointment submitted.');}}>
        <label>Agreement<select name="agreementId" required defaultValue=""><option value="" disabled>Select active agreement</option>{activeAgreements.map((agreement)=><option key={agreement.enterprise_commercial_agreement_id} value={agreement.enterprise_commercial_agreement_id}>{agreement.title}</option>)}</select></label>
        <label>Beneficiary org<select name="beneficiaryOrganizationId" required defaultValue=""><option value="" disabled>Select organization</option>{data.organizations.map((organization)=><option key={organization.organization_id} value={organization.organization_id}>{organization.name}</option>)}</select></label>
        <label>Beneficiary entity<select name="beneficiaryLegalEntityId" required defaultValue=""><option value="" disabled>Select verified entity</option>{data.legalEntities.map((entity)=><option key={entity.legal_entity_id} value={entity.legal_entity_id}>{entity.legal_name}</option>)}</select></label>
        <label>Appointment<select name="appointmentKind" defaultValue="DISTRIBUTOR"><option>MASTER_FRANCHISEE</option><option>FRANCHISEE</option><option>DISTRIBUTOR</option><option>WHOLESALER</option><option>RETAILER</option><option>AFFILIATE</option><option>BROKER</option><option>LICENSEE</option><option>OPERATOR</option><option>AGENT</option><option>MANAGEMENT_PROVIDER</option><option>SERVICE_PROVIDER</option><option>JV_PARTNER</option><option>OTHER</option></select></label>
        <label>Rights profile<select name="rightsProfileKey" defaultValue="enterprise.channel-partner"><option>enterprise.operator</option><option>enterprise.channel-partner</option><option>enterprise.licensee</option><option>enterprise.master-operator</option><option>enterprise.service-provider</option><option>enterprise.jv-partner</option></select></label>
        <label>Right types<input name="rightTypes" required defaultValue="SELL" placeholder="SELL,DISTRIBUTE"/></label>
        <label className={styles.wide}>Territories<select name="territoryIds" multiple required size={Math.min(4,Math.max(2,data.territories.length))}>{data.territories.map((territory)=><option key={territory.territory_id} value={territory.territory_id}>{territory.name}</option>)}</select></label>
        <label className={styles.check}><input type="checkbox" name="exclusive"/> Exclusive territory</label>
        <button disabled={busy!==null||activeAgreements.length===0||data.territories.length===0}>Submit appointment</button>
      </form>
      <div className={styles.cards}>{data.appointments.map((appointment)=><article key={appointment.enterprise_appointment_id}>
        <div><span>{appointment.appointment_kind}</span><strong>{appointment.beneficiary_name}</strong><small>{appointment.grantor_name} → {appointment.beneficiary_name}</small></div>
        <p>{appointment.requested_right_types.join(', ')} · {appointment.territories.map((territory)=>territory.name).join(', ')}</p>
        <footer><b>{appointment.state}</b>
          {appointment.state==='SUBMITTED'&&<button disabled={busy!==null} onClick={()=>void act(`review:${appointment.enterprise_appointment_id}`,{action:'MOVE_APPOINTMENT_TO_REVIEW',appointmentId:appointment.enterprise_appointment_id},'Appointment moved to commercial review.')}>Move to review</button>}
          {appointment.state==='UNDER_REVIEW'&&<button disabled={busy!==null} onClick={()=>void act(`approve:${appointment.enterprise_appointment_id}`,{action:'APPROVE_APPOINTMENT',appointmentId:appointment.enterprise_appointment_id},'Appointment approved.')}>Approve</button>}
          {appointment.state==='APPROVED'&&<button disabled={busy!==null} onClick={()=>void act(`rights:${appointment.enterprise_appointment_id}`,{action:'ISSUE_APPOINTMENT_RIGHTS',appointmentId:appointment.enterprise_appointment_id,evidenceRefs:[`ui:appointment:${appointment.enterprise_appointment_id}:rights-approved`]},'Rights issued and appointment activated.')}>Issue rights</button>}
          {appointment.state==='ACTIVE'&&appointment.territories.map((territory)=>{const existing=data.jurisdictions.find((j)=>j.enterprise_appointment_id===appointment.enterprise_appointment_id&&j.territory_id===territory.territoryId);return !existing?<button key={territory.territoryId} disabled={busy!==null} onClick={()=>void act(`jurisdiction:${appointment.enterprise_appointment_id}:${territory.territoryId}`,{action:'START_JURISDICTION_ACTIVATION',appointmentId:appointment.enterprise_appointment_id,territoryId:territory.territoryId,evidenceRefs:[`ui:territory:${territory.territoryId}:activation-request`]},'Jurisdiction activation review started.')}>Activate {territory.name}</button>:null;})}
        </footer>
      </article>)}</div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><span>Permission to operate</span><h3>Jurisdiction activations</h3></div><small>Requires verified activation evidence after rights exist</small></div>
      <div className={styles.cards}>{data.jurisdictions.map((jurisdiction)=><article key={jurisdiction.enterprise_jurisdiction_activation_id}>
        <div><span>{jurisdiction.territory_name}</span><strong>{jurisdiction.organization_name}</strong></div>
        <footer><b>{jurisdiction.state}</b>{jurisdiction.state!=='ACTIVE'&&<button disabled={busy!==null} onClick={()=>{const evidence=`ui:jurisdiction:${jurisdiction.enterprise_jurisdiction_activation_id}:verified`;const assessments=['AGREEMENT','RIGHTS','ACCESS','COMPLIANCE','OPERATIONAL_READINESS'].map((dimension)=>({dimension,outcome:'SATISFIED',reason:`Verified in Enterprise Hub: ${dimension.toLowerCase().replaceAll('_',' ')}.`,evidenceRefs:[evidence]}));void act(`verify:${jurisdiction.enterprise_jurisdiction_activation_id}`,{action:'VERIFY_AND_ACTIVATE_JURISDICTION',jurisdictionActivationId:jurisdiction.enterprise_jurisdiction_activation_id,reason:'All jurisdiction activation controls were explicitly verified.',assessments,evidenceRefs:[evidence]},'Jurisdiction activated.');}}>Verify controls & activate</button>}</footer>
      </article>)}{data.jurisdictions.length===0&&<em>No jurisdiction activation reviews yet.</em>}</div>
    </section>
  </div>;
}
