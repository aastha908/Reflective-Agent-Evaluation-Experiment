import "dotenv/config";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

process.env.DATABASE_URL ??= "file:./test.db";
const options = { stdio: "inherit" as const, env: process.env };
execFileSync(
  process.execPath,
  [resolve("node_modules/prisma/build/index.js"), "generate"],
  options,
);
execFileSync(
  process.execPath,
  [
    resolve("node_modules/prisma/build/index.js"),
    "db",
    "push",
    "--skip-generate",
  ],
  options,
);
execFileSync(
  process.execPath,
  [resolve("node_modules/vitest/vitest.mjs"), "run"],
  options,
);
