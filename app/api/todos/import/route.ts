import { secured, jsonBody } from "@/lib/api";
import { todoDB } from "@/lib/db";
export const POST = secured(async (req, s) => {
  const count = todoDB.importAll(s.userId, await jsonBody(req));
  return { message: `Successfully imported ${count} todos`, count };
});
