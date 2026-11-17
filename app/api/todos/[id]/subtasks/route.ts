import { secured, jsonBody, id } from "@/lib/api";
import { subtaskDB } from "@/lib/db";
import { titleSchema } from "@/lib/validation";
export const POST = secured(async (req, s, p) =>
  subtaskDB.add(
    id(p.id),
    s.userId,
    titleSchema.parse((await jsonBody(req)).title),
  ),
);
