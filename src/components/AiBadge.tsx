"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "./api";

interface Status {
  ai: boolean;
  provider: string | null;
  model: string | null;
  choice?: string;
}

/** Fired by the Settings page after saving, so the badge shows the new provider straight away. */
export const SETTINGS_CHANGED = "zilearn:settings-changed";

export function AiBadge() {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    const load = () => api<Status>("/api/status").then(setS).catch(() => {});
    load();
    window.addEventListener(SETTINGS_CHANGED, load);
    return () => window.removeEventListener(SETTINGS_CHANGED, load);
  }, []);
  if (!s) return null;
  if (s.ai)
    return (
      <Link href="/settings" className="badge know ai-badge" title={`Using ${s.provider} (${s.model}). Change in Settings.`}>
        {s.provider} connected
      </Link>
    );
  return (
    <Link
      href="/settings"
      className="badge familiar ai-badge"
      title={
        s.choice === "builtin"
          ? "Using the built-in offline helpers. Pick an AI provider in Settings."
          : "No AI key found, so built-in offline helpers are used. Add a key in Settings."
      }
    >
      {s.choice === "builtin" ? "Built-in mode" : "Offline mode"}
    </Link>
  );
}
