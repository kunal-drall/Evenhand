import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { loadDotEnv } from "./env-file.js";

loadDotEnv();
const config = loadConfig();
const app = createApp(openDb(config.dbPath));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`evenhand server listening on :${info.port}`);
});
