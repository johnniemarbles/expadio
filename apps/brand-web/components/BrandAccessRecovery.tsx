'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import styles from '../app/(workspace)/workspace.module.css';

const explanations:Record<string,string>={
  NO_MATCHING_MEMBERSHIP:'No EXPADIO membership matches this Clerk user. The Platform may have granted access to a different Clerk account.',
  MEMBERSHIP_SUSPENDED:'This membership is suspended in Platform. Restore it before retrying Brand access.',
  MEMBERSHIP_REVOKED:'This membership is revoked. Platform must grant a new membership before Brand access can resume.',
  MEMBERSHIP_EXPIRED:'This membership has expired. Platform must extend or re-grant access.',
  ACTIVE_MEMBERSHIP_NOT_RESOLVED:'An active membership exists, but its tenant or organization could not be resolved as active. Check Platform workspace state.',
};

export function BrandAccessRecovery({
  subjectId,reason,membershipStatus,validUntil,
}:{
  subjectId:string;reason:string;membershipStatus:string|null;validUntil:string|null;
}){
  const {signOut}=useClerk();
  const {user}=useUser();
  const email=user?.primaryEmailAddress?.emailAddress
    ?? user?.emailAddresses?.[0]?.emailAddress
    ?? 'Email unavailable';
  const activeUserId=user?.id??subjectId;

  async function switchAccount(){
    await signOut({redirectUrl:window.location.origin});
  }

  return <div className={styles.accessRecovery}>
    <div className={styles.accessIdentity}>
      <span>Signed in as</span>
      <strong>{email}</strong>
      <code>{activeUserId}</code>
    </div>
    <div className={styles.accessDiagnostic}>
      <strong>{membershipStatus?'Membership: '+membershipStatus:'No matching membership'}</strong>
      <p>{explanations[reason]??'Brand access could not be resolved for this identity.'}</p>
      {validUntil?<span>Access expiry: {new Date(validUntil).toLocaleString()}</span>:null}
    </div>
    <div className={styles.accessActions}>
      <button type="button" className={styles.button} onClick={()=>window.location.reload()}>
        Retry access
      </button>
      <button type="button" className={styles.secondaryButton} onClick={()=>void switchAccount()}>
        Sign out & use another account
      </button>
    </div>
    <div className={styles.accessHint}>
      Compare the Clerk user ID above with the Clerk ID shown for the membership in Platform → Tenant Users & Access.
    </div>
  </div>;
}
