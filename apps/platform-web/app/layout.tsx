import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@expadio/ui/tokens";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "EXPADIO Platform",
  description: "Governed operations for organizations, capabilities and company knowledge.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
