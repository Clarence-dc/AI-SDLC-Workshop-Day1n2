import { z } from "zod";
import { secured, jsonBody, id } from "@/lib/api";
import { tagDB } from "@/lib/db";
const body = z.object({ tag_id: z.number().int().positive() });
export const POST = secured(async (req, s, p) =>
  tagDB.attach(id(p.id), body.parse(await jsonBody(req)).tag_id, s.userId),
);
export const DELETE = secured(async (req, s, p) =>
  tagDB.detach(id(p.id), body.parse(await jsonBody(req)).tag_id, s.userId),
);
