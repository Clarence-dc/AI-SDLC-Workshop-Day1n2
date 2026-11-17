import { secured, jsonBody, id } from "@/lib/api";
import { todoDB } from "@/lib/db";
export const GET = secured((_req, s, p) => todoDB.get(id(p.id), s.userId));
export const PUT = secured(async (req, s, p) =>
  todoDB.update(id(p.id), s.userId, await jsonBody(req)),
);
export const DELETE = secured((_req, s, p) =>
  todoDB.delete(id(p.id), s.userId),
);
