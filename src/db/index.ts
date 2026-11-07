import postgres from "postgres";
import { SCHEMA } from "./schema";

declare global { var __sql: ReturnType<typeof postgres> | undefined }

export const sql =
  globalThis.__sql ??
  (globalThis.__sql = postgres(process.env.DATABASE_URL!, {
    max: 3,
    prepare: false, // required for Neon's pooled connection
    ssl: process.env.DATABASE_URL?.includes("localhost") ? false : "require",
  }));

let migrated = false;
export async function migrate() {
  if (migrated) return;
  await sql.unsafe(SCHEMA);
  migrated = true;
}
