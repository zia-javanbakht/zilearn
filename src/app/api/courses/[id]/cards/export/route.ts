import { cardsApkg, cardsCsv } from "@/lib/cardExport";
import { getCourse, listCards } from "@/lib/store";
import { fail, fileResponse, handle, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The course's flashcards as ?format=apkg (an Anki deck) or csv. */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const course = getCourse(id);
  if (!course) return fail("Course not found", 404);
  const cards = listCards(id);
  if (!cards.length) return fail("This course has no flashcards yet.");
  const name = (course.code ? `${course.code} ${course.name}` : course.name).replace(/[\\/:*?"<>|]+/g, " ").trim() || "ziLearn";
  const format = new URL(req.url).searchParams.get("format");
  if (format === "apkg")
    return fileResponse(req, await cardsApkg(name, cards), { mime: "application/octet-stream", filename: `${name} flashcards.apkg`, inline: false });
  return fileResponse(req, Buffer.from(cardsCsv(cards), "utf8"), { mime: "text/csv; charset=utf-8", filename: `${name} flashcards.csv`, inline: false });
});
