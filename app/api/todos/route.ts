import { secured, jsonBody } from "@/lib/api";
import { todoDB } from "@/lib/db";
export const GET = secured((_req, s) => todoDB.all(s.userId));
export const POST = secured(async (req, s) =>
  todoDB.create(s.userId, await jsonBody(req)),
);
