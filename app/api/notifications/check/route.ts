import { secured } from "@/lib/api";
import { todoDB } from "@/lib/db";
export const GET = secured((_req, s) => ({
  todos: todoDB.notifications(s.userId),
}));
