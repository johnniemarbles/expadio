import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EXPADIO Platform",
  description: "Governed operations for organizations, capabilities and company knowledge.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
