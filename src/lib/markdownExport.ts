/**
 * A lesson's Markdown as it leaves the app: the hints about tapping the map and the `%% jump` lines that
 * tell the app which section a box opens mean nothing in a file or another editor.
 */
export function exportableMarkdown(md: string): string {
  return md
    .replace(/^\s*<p class="lb-hint">[\s\S]*?<\/p>\s*$/gm, "")
    .replace(/^[ \t]*%% jump\b.*\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
