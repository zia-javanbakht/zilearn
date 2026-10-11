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
