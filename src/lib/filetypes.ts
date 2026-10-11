/** Which files a folder import should leave out. Pure, so the browser filters before uploading too. */

// Operating-system and editor clutter that never belongs in a course.
const JUNK = /(^|\/)(\.[^/]*|~\$[^/]*|__MACOSX|Thumbs\.db|desktop\.ini|node_modules|\$RECYCLE\.BIN)(\/|$)/i;
// Files ziLearn can't read and that would only clutter the list.
const UNSUPPORTED = /\.(exe|dll|app|dmg|iso|msi|bin|so|dylib|class|o|pyc|lnk|tmp|bak|log|ds_store|ini|sys|db|sqlite|7z|rar|tar|gz|tgz|xz|bz2)$/i;

export function isJunk(relPath: string): boolean {
  return JUNK.test(relPath.replace(/\\/g, "/"));
}

export function isUnsupported(name: string): boolean {
  return UNSUPPORTED.test(name);
}

export const CAPTIONS = /\.(srt|vtt)$/i;
export const SHORTCUT = /\.(url|webloc|desktop)$/i;
export const MEDIA = /\.(mp3|m4a|wav|ogg|oga|webm|aac|flac|opus|mp4|m4v|mov|mkv|avi)$/i;

/** The web address inside a saved link (Windows .url, macOS .webloc, Linux .desktop), if any. */
export function linkFromShortcut(text: string): string | null {
  const m = text.match(/^\s*URL\s*=\s*(https?:\/\/\S+)/im) ?? text.match(/<string>\s*(https?:\/\/[^<\s]+)\s*<\/string>/i);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

/** "Week 1/Lecture 2.en.srt" and "Week 1/Lecture 2.mp4" share the stem "week 1/lecture 2". */
export function mediaStem(relPathOrName: string): string {
  return relPathOrName
    .replace(/\\/g, "/")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/\.(?:[a-z]{2,3}(?:[-_][a-z0-9]{2,4})?|auto|asr)$/i, "")
    .toLowerCase();
}
