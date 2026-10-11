"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export function AiBadge() {
  const [s, setS] = useState<{ ai: boolean; provider: string | null; model: string | null } | null>(null);
  useEffect(() => {
    api<{ ai: boolean; provider: string | null; model: string | null }>("/api/status").then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  return s.ai ? (
    <span className="badge know" title={`Using ${s.model}`}>{s.provider} connected</span>
  ) : (
    <span className="badge familiar" title="Set ANTHROPIC_API_KEY (Claude) or GEMINI_API_KEY (Gemini) to enable AI. Built-in heuristics are used meanwhile.">Offline mode</span>
  );
}
