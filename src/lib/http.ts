import { NextResponse } from "next/server";
import { aiErrorMessage, errorStatus, requestSignal } from "./ai";

export type Ctx<P> = { params: Promise<P> };

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Wrap a handler so thrown errors become JSON responses instead of HTML 500 pages. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      const req = args[0];
      // Expose the request's abort signal to Claude calls made while handling it.
      return req instanceof Request ? await requestSignal.run(req.signal, () => fn(...args)) : await fn(...args);
    } catch (err) {
      const status = errorStatus(err);
      if (status >= 500) console.error(err);
      return fail(aiErrorMessage(err), status);
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** The student's local date (YYYY-MM-DD) from the client, falling back to the server's date. */
export function todayFrom(v: unknown): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) return v;
  return new Date().toISOString().slice(0, 10);
}

/**
 * Serve a stored file. Supports HTTP Range requests so audio and video players can seek.
 * `inline` files open in the browser; anything else downloads. Files are sandboxed and never sniffed.
 */
export function fileResponse(req: Request, buf: Buffer, opts: { mime: string; filename: string; inline: boolean }): Response {
  const headers: Record<string, string> = {
    "content-type": opts.inline ? opts.mime : "application/octet-stream",
    "content-disposition": `${opts.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
    "accept-ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = buf.length;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    return new Response(new Uint8Array(buf.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(buf), { headers: { ...headers, "content-length": String(buf.length) } });
}
