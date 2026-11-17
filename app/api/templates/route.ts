import { secured, jsonBody } from "@/lib/api";
import { templateDB } from "@/lib/db";
export const GET = secured((_req, s) => templateDB.all(s.userId));
export const POST = secured(async (req, s) =>
  templateDB.create(s.userId, await jsonBody(req)),
);
