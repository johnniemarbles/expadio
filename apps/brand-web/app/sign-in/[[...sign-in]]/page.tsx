import { SignIn } from '@clerk/nextjs';
export default function Page(){return <main style={{minHeight:'100vh',display:'grid',placeItems:'center'}}><SignIn path="/sign-in" routing="path" signUpUrl="/sign-up"/></main>}
