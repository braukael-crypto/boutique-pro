import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Load local environment files when present so Prisma CLI can resolve datasource
// variables (e.g. DIRECT_URL) without exposing or altering secret values.
loadEnv({ path: ".env.local", override: false });
loadEnv({ path: ".env", override: false });

// Schema-engine (Prisma Migrate) can fail to connect to Supabase pooler endpoints
// in some environments without an explicit connect timeout, causing P1001 even when
// the database is reachable (e.g. via pg). Append a conservative timeout if absent,
// without altering or exposing the underlying connection credentials.
// Prisma generate does not need a database connection. Supplying a datasource URL
// is optional for generate/validate; migration commands still require DIRECT_URL.
const directUrl = process.env.DIRECT_URL?.trim();
const migrateUrl = directUrl
  ? /[?&]connect_timeout=/.test(directUrl)
    ? directUrl
    : `${directUrl}${directUrl.includes("?") ? "&" : "?"}connect_timeout=10`
  : undefined;
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrateUrl,
  },
});
