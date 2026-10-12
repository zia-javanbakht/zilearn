"use client";

import { isJunk, isUnsupported } from "@/lib/filetypes";

/** A file picked for import, with its path inside the chosen folder ("" for loose files). */
export interface PickedFile {
  file: File;
  path: string;
}

/** Keep only files worth importing; returns how many were left out. */
export function filterPicked(list: PickedFile[]): { keep: PickedFile[]; ignored: number } {
  const keep = list.filter((p) => !isJunk(p.path || p.file.name) && !isUnsupported(p.file.name));
  return { keep, ignored: list.length - keep.length };
}

/** Files from <input type=file webkitdirectory> or a plain multi-file input. */
export function fromInput(files: FileList): PickedFile[] {
  return Array.from(files).map((file) => ({ file, path: file.webkitRelativePath || "" }));
}

/** Files from a drop, walking into any dropped folders (and their subfolders). */
export async function fromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(dt.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.some((e) => e.isDirectory)) return Array.from(dt.files).map((file) => ({ file, path: "" }));
  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (isJunk(prefix + entry.name)) return;
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix ? prefix + entry.name : "" });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns at most ~100 entries per call; keep reading until it returns none.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

/** Group files into upload requests of at most `maxFiles` files or `maxBytes` bytes (a bigger file goes alone). */
export function batches(list: PickedFile[], maxFiles = 8, maxBytes = 40 * 1024 * 1024): PickedFile[][] {
  const out: PickedFile[][] = [];
  let cur: PickedFile[] = [];
  let size = 0;
  for (const p of list) {
    if (cur.length && (cur.length >= maxFiles || size + p.file.size > maxBytes)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += p.file.size;
  }
  if (cur.length) out.push(cur);
  return out;
}
