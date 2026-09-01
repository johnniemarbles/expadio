import { SignUp } from '@clerk/nextjs';
export default function Page(){return <main style={{minHeight:'100vh',display:'grid',placeItems:'center'}}><SignUp path="/sign-up" routing="path" signInUrl="/sign-in"/></main>}
