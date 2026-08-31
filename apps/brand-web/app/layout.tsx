import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'EXPADIO Brand',
  description: 'Brand workspace on app.expadio.com',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0f1115', color: '#e8eaed' }}>
        {children}
      </body>
    </html>
  );
}
