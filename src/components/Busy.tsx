"use client";

import { useEffect, useState } from "react";

/** Spinner plus elapsed time for long Claude generations, so a slow request doesn't look stuck. */
export function Busy({ label, hint = "usually 1-3 min" }: { label: string; hint?: string }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span role="status">
      <span className="spinner" aria-hidden /> {label} {secs >= 5 && <span className="small">({fmt(secs)}, {hint})</span>}
    </span>
  );
}

function fmt(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
