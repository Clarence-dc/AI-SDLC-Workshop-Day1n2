import { secured } from "@/lib/api";
import { holidayDB } from "@/lib/db";
export const GET = secured(() => holidayDB.all());
