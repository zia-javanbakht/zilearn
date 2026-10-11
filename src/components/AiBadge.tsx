"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export function AiBadge() {
  const [s, setS] = useState<{ ai: boolean; model: string | null } | null>(null);
  useEffect(() => {
    api<{ ai: boolean; model: string | null }>("/api/status").then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  return s.ai ? (
    <span className="badge know" title={`Using ${s.model}`}>Claude connected</span>
  ) : (
    <span className="badge familiar" title="Set ANTHROPIC_API_KEY to enable Claude. Built-in heuristics are used meanwhile.">Offline mode</span>
  );
}
