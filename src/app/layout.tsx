import type { Metadata } from "next";
import Link from "next/link";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AiBadge } from "@/components/AiBadge";

export const metadata: Metadata = {
  title: "ziLearn",
  description: "Your study suite: brainmaps, progressive study plans, knowledge base, mock exams, review notes and podcasts.",
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
      </body>
    </html>
  );
}
