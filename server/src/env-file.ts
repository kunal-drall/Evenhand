import { fileURLToPath } from "node:url";

/** Loads the repo-root .env (two levels above server/src, server/dist and server/scripts). Missing file is fine. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
  } catch {
    // no .env: rely on the real environment
  }
}
