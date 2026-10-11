"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Mermaid } from "./Mermaid";

// Allow <details>/<summary> from generated lessons and keep code-block language classes.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-/, /^math-/]],
    // Lesson block boxes (definition, intuition, example, ...).
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "lb", /^lb-[a-z]+$/]],
  },
};

// Module-level so re-renders of the parent don't remount code blocks (and re-render diagrams).
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeRaw, [rehypeSanitize, schema], rehypeKatex] as NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>;
const components: Components = {
  code({ className, children: c, node: _node, ...props }) {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    if (lang === "mermaid") return <Mermaid code={String(c).trim()} fit />;
    return (
      <code className={className} {...props}>
        {c}
      </code>
    );
  },
};

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
