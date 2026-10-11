import { search } from "@/lib/kb";
import { handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle((req: Request) => {
  const u = new URL(req.url);
  return ok(search(u.searchParams.get("q") ?? "", u.searchParams.get("course") || undefined));
});
