import "dotenv/config";
import { seed } from "./seed.js";

void seed().catch((error) => {
  console.error(
    "Database seeding failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
