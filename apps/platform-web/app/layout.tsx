import type { Metadata } from "next";
import { cookies } from 'next/headers';
import { ClerkProvider } from "@clerk/nextjs";
import "@expadio/ui/tokens";
import "./globals.css";

export const metadata: Metadata = { 
  title: "EXPADIO Platform", 
  description: "Governed operations for organizations, capabilities and company knowledge." 
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const themeCookie = (await cookies()).get('expadio-theme-mode')?.value;
  const themeMode = themeCookie === 'light' || themeCookie === 'system' ? themeCookie : 'dark';
  return (
    <ClerkProvider>
      <html lang="en" data-theme={themeMode}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  ); 
}
