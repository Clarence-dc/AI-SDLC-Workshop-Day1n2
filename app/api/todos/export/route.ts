import { secured, HttpError } from "@/lib/api";
import { todoDB } from "@/lib/db";
import { singaporeDay } from "@/lib/timezone";
import { toCSV } from "@/lib/todos";
export const GET = secured((req, s) => {
  const format = req.nextUrl.searchParams.get("format") || "json";
  if (!["json", "csv"].includes(format))
    throw new HttpError("Invalid export format", 400);
  return new Response(
    format === "json"
      ? JSON.stringify(todoDB.exportAll(s.userId), null, 2)
      : toCSV(todoDB.all(s.userId)),
    {
      headers: {
        "Content-Type":
          format === "json" ? "application/json" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="todos-${singaporeDay()}.${format}"`,
        "Cache-Control": "no-store",
      },
    },
  );
});
