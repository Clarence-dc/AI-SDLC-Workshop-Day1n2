import { z } from "zod";
import { secured, jsonBody, id } from "@/lib/api";
import { subtaskDB } from "@/lib/db";
import { titleSchema } from "@/lib/validation";
export const PUT = secured(async (req, s, p) =>
  subtaskDB.update(
    id(p.id),
    s.userId,
    z
      .object({
        title: titleSchema.optional(),
        completed: z.boolean().optional(),
      })
      .parse(await jsonBody(req)),
  ),
);
export const DELETE = secured((_req, s, p) =>
  subtaskDB.delete(id(p.id), s.userId),
);
