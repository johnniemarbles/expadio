import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ClerkProvider } from '@clerk/nextjs';
import '@expadio/ui/tokens';
import './globals.css';

export const metadata: Metadata = {
  title: 'EXPADIO Learning',
  description: 'Tenant learning, skills and certification workspace.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const themeCookie = (await cookies()).get('expadio-theme-mode')?.value;
  const themeMode = themeCookie === 'light' || themeCookie === 'system' ? themeCookie : 'dark';
  return (
    <ClerkProvider>
      <html lang="en" data-theme={themeMode}><body>{children}</body></html>
    </ClerkProvider>
  );
}
