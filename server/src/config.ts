import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DB_PATH: z.string().min(1).default("data/evenhand.sqlite"),
});

export type Config = { port: number; dbPath: string };

/** Reads and validates server env. Secrets are read by the modules that need them, never logged. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  return { port: parsed.PORT, dbPath: parsed.DB_PATH };
}
