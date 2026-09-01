'use client';
import { useState } from 'react';import { useRouter } from 'next/navigation';
export function ActivateLearningButton(){const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const router=useRouter();
async function activate(){setBusy(true);setError(null);try{const response=await fetch('/api/learning/activate',{method:'POST'});const payload=await response.json() as {error?:string};if(!response.ok)throw new Error(payload.error??'Activation failed.');router.refresh()}catch(cause){setError(cause instanceof Error?cause.message:'Activation failed.')}finally{setBusy(false)}}
return <div><button type="button" disabled={busy} onClick={()=>void activate()}>{busy?'Activating…':'Activate Learning'}</button>{error?<p role="alert">{error}</p>:null}</div>}
