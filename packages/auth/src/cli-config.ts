// Used only by `pnpm --filter @codechatter/auth generate-schema`, which writes
// packages/db/src/schema/auth.ts. The adapter is never queried here.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { schemaShapingOptions } from "./options.js";

export const auth = betterAuth({
  ...schemaShapingOptions(),
  database: drizzleAdapter({} as never, { provider: "pg" }),
});
