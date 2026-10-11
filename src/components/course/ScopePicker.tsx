"use client";

import type { TopicNode } from "@/lib/types";

export type ScopeValue = { kind: "course" } | { kind: "weak" } | { kind: "topic"; topicId: string };

export function ScopePicker({ tree, value, onChange }: { tree: TopicNode[]; value: ScopeValue; onChange: (v: ScopeValue) => void }) {
  const options: { v: string; label: string }[] = [
    { v: "course", label: "Whole course" },
    { v: "weak", label: "Only topics I don't know yet" },
  ];
  const walk = (ns: TopicNode[], depth: number) => {
    for (const n of ns) {
      options.push({ v: `topic:${n.id}`, label: `${"  ".repeat(depth)}${depth ? "└ " : ""}${n.title}` });
      if (depth < 2) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  const current = value.kind === "topic" ? `topic:${value.topicId}` : value.kind;
  return (
    <label className="field">
      Scope
      <select
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v.startsWith("topic:") ? { kind: "topic", topicId: v.slice(6) } : ({ kind: v } as ScopeValue));
        }}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
