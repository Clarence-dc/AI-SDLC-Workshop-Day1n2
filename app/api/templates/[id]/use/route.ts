import { secured, id } from "@/lib/api";
import { templateDB } from "@/lib/db";
export const POST = secured((_req, s, p) => templateDB.use(id(p.id), s.userId));
