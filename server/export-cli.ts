import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { exportBundle, exportCsv } from "./exports.js";

const prisma = new PrismaClient();
const output = resolve(process.argv[2] ?? "exports");
await mkdir(output, { recursive: true });
for (const dataset of [
  "experiments",
  "experiment_config_snapshots",
  "runs",
  "turns",
  "tool_calls",
  "tool_results",
  "state_transitions",
  "metrics_long",
  "metrics_wide",
  "human_reviews",
  "errors",
  "model_requests",
  "model_responses",
  "environment_snapshots",
  "automated_scores",
  "metric_definitions",
  "provider_configurations",
  "model_configurations",
  "audit_log",
  "analysis",
]) {
  const contents = await exportCsv(dataset);
  if (contents !== null)
    await writeFile(
      resolve(output, `${dataset}.csv`),
      `\uFEFF${contents}`,
      "utf8",
    );
}
await writeFile(resolve(output, "research-export.zip"), await exportBundle());
await prisma.$disconnect();
console.log(`Export written to ${output}`);
