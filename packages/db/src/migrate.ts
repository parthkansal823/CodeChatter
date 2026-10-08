import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const handle = createDb(url, { max: 1 });
await migrate(handle.db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
await handle.close();
console.log("migrations applied");
