import { secured, jsonBody, id } from "@/lib/api";
import { templateDB } from "@/lib/db";
export const PUT = secured(async (req, s, p) =>
  templateDB.update(id(p.id), s.userId, await jsonBody(req)),
);
export const DELETE = secured((_req, s, p) =>
  templateDB.delete(id(p.id), s.userId),
);
