import { secured, jsonBody, id } from "@/lib/api";
import { tagDB } from "@/lib/db";
import { tagSchema } from "@/lib/validation";
export const PUT = secured(async (req, s, p) =>
  tagDB.update(
    id(p.id),
    s.userId,
    tagSchema.parse({
      ...tagDB.get(id(p.id), s.userId),
      ...(await jsonBody(req)),
    }),
  ),
);
export const DELETE = secured((_req, s, p) => tagDB.delete(id(p.id), s.userId));
