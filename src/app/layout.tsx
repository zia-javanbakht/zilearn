import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AiBadge } from "@/components/AiBadge";
import { InstallApp } from "@/components/InstallApp";

export const metadata: Metadata = {
  title: "ziLearn",
  description: "Your study suite: brainmaps, progressive study plans, knowledge base, mock exams, review notes and podcasts.",
  appleWebApp: { capable: true, title: "ziLearn", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#161b2e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            zi<span>Learn</span>
          </Link>
          <nav>
            <Link href="/">Courses</Link>
            <Link href="/knowledge">Knowledge base</Link>
            <Link href="/settings">Settings</Link>
          </nav>
          <AiBadge />
        </header>
        <main>{children}</main>
        <InstallApp />
      </body>
    </html>
  );
}
