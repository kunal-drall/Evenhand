import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";

// Repo-root .env (one level above server/src and server/dist). Missing file is fine.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // no .env: rely on the real environment
}

const config = loadConfig();
const app = createApp(openDb(config.dbPath));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`evenhand server listening on :${info.port}`);
});
