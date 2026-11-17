import { secured, jsonBody } from "@/lib/api";
import { tagDB } from "@/lib/db";
import { tagSchema } from "@/lib/validation";
export const GET = secured((_req, s) => tagDB.all(s.userId));
export const POST = secured(async (req, s) =>
  tagDB.create(s.userId, tagSchema.parse(await jsonBody(req))),
);
