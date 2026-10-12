import { stat } from "node:fs/promises";
import path from "node:path";
import { compileTex, saveZDir, TexError, texSetup } from "@/lib/texPdf";
import { body, fail, handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** What this computer has for making PDFs: the TeX engine and where the Z class is. */
export const GET = handle(async (req: Request) => ok(await texSetup(new URL(req.url).searchParams.has("fresh"))));

/** Save the folder that holds the Z class (its tex/latex folder), or clear it with an empty value. */
export const PUT = handle(async (req: Request) => {
  const { zDir } = await body<{ zDir?: unknown }>(req);
  const dir = typeof zDir === "string" ? zDir.trim().replace(/^~(?=$|[\\/])/, process.env.HOME ?? process.env.USERPROFILE ?? "~") : "";
  if (dir) {
    if (!path.isAbsolute(dir)) return fail("Give the full path of the folder, e.g. /Users/you/z/tex/latex.");
    if (!(await stat(dir).catch(() => null))?.isDirectory()) return fail("That folder doesn't exist on the computer that runs ziLearn.");
  }
  saveZDir(dir || null);
  const setup = await texSetup(true);
  if (dir && setup.z.from !== "settings")
    return ok({
      ...setup,
      warning: "No Z.cls was found in that folder (or up to three levels inside it).",
    });
  return ok(setup);
});

/** Compile a one-page test document with the Z class, to check the setup. */
export const POST = handle(async () => {
  const setup = await texSetup(true);
  const source = String.raw`\documentclass[10pt,stix,minimal]{Z}
\begin{document}
\begin{definition}[A test]
ziLearn can make PDFs here: $\int_0^1 x\,\mathrm{d}x = \tfrac12$.
\end{definition}
\end{document}
`;
  try {
    const started = Date.now();
    const { note, engine } = await compileTex(source, "ziLearn-test");
    return ok({
      ...setup,
      test: {
        ok: true,
        engine,
        note,
        seconds: Math.round((Date.now() - started) / 100) / 10,
      },
    });
  } catch (e) {
    if (e instanceof TexError) return ok({ ...setup, test: { ok: false, error: e.message } });
    throw e;
  }
});
