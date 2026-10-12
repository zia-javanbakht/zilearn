import { describe, expect, it } from "vitest";
import { exportableMarkdown } from "@/lib/markdownExport";

describe("Markdown export", () => {
  it("drops the map's tap hint and the app's jump lines, keeping the diagram", () => {
    const md = '# L\n\n### Map of this lesson\n\n```mermaid\nflowchart LR\n  a["Mass"] --> b["Stiffness"]\n  %% jump a 1\n  %% jump b 2\n```\n\n<p class="lb-hint">Each box is a key term. Tap a box to jump to its section.</p>\n\n## 1 Mass\n\n50% of it.';
    expect(exportableMarkdown(md)).toBe('# L\n\n### Map of this lesson\n\n```mermaid\nflowchart LR\n  a["Mass"] --> b["Stiffness"]\n```\n\n## 1 Mass\n\n50% of it.');
  });
});
