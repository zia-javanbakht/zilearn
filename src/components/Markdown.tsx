"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { DiagramEditor } from "./DiagramEditor";
import { Plot } from "./Plot";
import type { PlotSpec } from "@/lib/figure";

// Allow <details>/<summary> from generated lessons and keep code-block language classes.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-/, /^math-/]],
    // Lesson block boxes (definition, intuition, example, ...).
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "lb", /^lb-[a-z]+$/]],
    p: [...(defaultSchema.attributes?.p ?? []), ["className", "lb-source", "lb-terms", "lb-hint"]],
  },
};

// Module-level so re-renders of the parent don't remount code blocks (and re-render diagrams).
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeRaw, [rehypeSanitize, schema], rehypeKatex] as NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>;
const components: Components = {
  code({ className, children: c, node: _node, ...props }) {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    if (lang === "mermaid") {
      const code = String(c).trim();
      // A lesson's concept map: "%% jump k0 ②" opens the section headed ② when box k0 is clicked.
      const jumps = new Map([...code.matchAll(/^\s*%% jump (\S+) (\S+)\s*$/gm)].map((m) => [m[1], m[2]]));
      // Any diagram can be edited in place; the edit is kept for that diagram wherever it shows.
      return <DiagramEditor code={code} fit onNodeClick={jumps.size ? (nid) => jumpTo(jumps.get(nid)) : undefined} />;
    }
    if (lang === "plot") {
      try {
        return <Plot spec={JSON.parse(String(c)) as PlotSpec} />;
      } catch {
        /* not a plot spec: show it as code */
      }
    }
    return (
      <code className={className} {...props}>
        {c}
      </code>
    );
  },
};

/** Scrolls to the lesson section whose heading starts with a badge such as "②", and flashes it. */
function jumpTo(badge: string | undefined) {
  if (!badge) return;
  const h = [...document.querySelectorAll<HTMLElement>(".markdown h3")].find((x) => x.textContent?.trim().startsWith(badge));
  if (!h) return;
  h.scrollIntoView({ behavior: "smooth", block: "start" });
  h.classList.remove("flash");
  void h.offsetWidth;
  h.classList.add("flash");
}

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});

/** Render FTS snippets, where matches are wrapped in [[ ]]. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[\[[^\]]*\]\])/g);
  return (
    <span>
      {parts.map((p, i) => (p.startsWith("[[") ? <mark key={i}>{p.slice(2, -2)}</mark> : <span key={i}>{p}</span>))}
    </span>
  );
}
