import "dotenv/config";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { conditions, configHash, scenarios } from "./research.js";
import { seed } from "./seed.js";
import { startWorker } from "./runner.js";
import { executeSimulatedTool, initialState } from "./simulator.js";
import { exportCsv, exportBundle } from "./exports.js";
import { redactSecrets } from "./redaction.js";

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const sessions = new Set<string>();
const isDevelopment = process.env.NODE_ENV !== "production";

app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...(isDevelopment ? ["'unsafe-eval'"] : [])],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "http://127.0.0.1:4000"],
      },
    },
  }),
);
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.post(
  "/api/login",
  rateLimit({ windowMs: 60_000, limit: 8 }),
  (req, res) => {
    const password = process.env.ADMIN_PASSWORD;
    if (password && req.body?.password !== password)
      return res
        .status(401)
        .json({ error: "Incorrect local researcher password" });
    const token = randomUUID();
    sessions.add(token);
    res.cookie("researcher_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: !isDevelopment,
      maxAge: 8 * 60 * 60 * 1000,
    });
    return res.json({ authenticated: true });
  },
);
app.get("/api/auth/status", (req, res) => {
  const cookie = req.headers.cookie?.match(
    /(?:^|;\s*)researcher_session=([^;]+)/,
  )?.[1];
  res.json({
    passwordRequired: Boolean(process.env.ADMIN_PASSWORD),
    authenticated:
      !process.env.ADMIN_PASSWORD ||
      Boolean(cookie && sessions.has(decodeURIComponent(cookie))),
  });
});
app.post("/api/logout", (req, res) => {
  const token = req.headers.cookie?.match(
    /(?:^|;\s*)researcher_session=([^;]+)/,
  )?.[1];
  if (token) sessions.delete(token);
  res.clearCookie("researcher_session", { sameSite: "strict" });
  res.json({ authenticated: false });
});
app.use("/api", (req, res, next) => {
  if (
    req.path === "/login" ||
    req.path === "/health" ||
    req.path === "/auth/status"
  )
    return next();
  const cookie = req.headers.cookie?.match(
    /(?:^|;\s*)researcher_session=([^;]+)/,
  )?.[1];
  if (
    process.env.ADMIN_PASSWORD &&
    (!cookie || !sessions.has(decodeURIComponent(cookie)))
  )
    return res.status(401).json({ error: "Researcher login required" });
  const origin = req.headers.origin;
  if (origin && origin !== (process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173"))
    return res.status(403).json({ error: "Origin not allowed" });
  return next();
});

const createSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(4000).default(""),
  researcher: z.string().max(160).default("Local researcher"),
  tags: z.array(z.string().max(64)).default([]),
  notes: z.string().max(8000).default(""),
  provider: z
    .enum(["mock", "openai", "openai-compatible", "anthropic"])
    .default("mock"),
  model: z.string().min(1).max(120).default("mock-deterministic-v1"),
  conditions: z.array(z.enum(["C1", "C2"])).min(1),
  scenarios: z.array(z.string().regex(/^S[1-5]$/)).min(1),
  replicates: z.number().int().min(1).max(100).default(1),
  policyMode: z
    .enum(["observe_only", "block_prohibited"])
    .default("block_prohibited"),
  temperature: z.number().min(0).max(2).default(0),
  topP: z.number().min(0).max(1).default(1),
  maxTokens: z.number().int().min(1).max(32000).default(2048),
  maxTurns: z.number().int().min(1).max(30).default(5),
  retryCount: z.number().int().min(0).max(5).default(0),
  timeoutSeconds: z.number().int().min(5).max(600).default(120),
  seed: z.number().int().optional(),
  randomize: z.boolean().default(false),
  prompts: z.record(z.string(), z.string()).optional(),
});

app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", version: "1.0.0", sandbox: true }),
);
app.get("/api/providers", (_req, res) =>
  res.json([
    { id: "mock", configured: true, credentialReference: null },
    {
      id: "openai",
      configured: Boolean(process.env.OPENAI_API_KEY),
      credentialReference: process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : null,
    },
    {
      id: "anthropic",
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      credentialReference: process.env.ANTHROPIC_API_KEY
        ? "ANTHROPIC_API_KEY"
        : null,
    },
    {
      id: "openai-compatible",
      configured: Boolean(
        process.env.OPENAI_API_KEY && process.env.OPENAI_COMPATIBLE_BASE_URL,
      ),
      credentialReference: process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : null,
    },
  ]),
);
app.get("/api/conditions", (_req, res) => res.json(conditions));
app.get("/api/scenarios", async (_req, res) =>
  res.json(
    await prisma.scenario.findMany({
      include: { versions: true, runs: false },
    }),
  ),
);
app.get("/api/experiments", async (_req, res) => {
  const experiments = await prisma.experiment.findMany({
    orderBy: { createdAt: "desc" },
    include: { runs: { select: { id: true, status: true } } },
  });
  res.json(experiments);
});
app.post("/api/experiments", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: "Invalid experiment configuration",
      details: parsed.error.issues,
    });
  const input = parsed.data;
  if (input.scenarios.some((id) => !scenarios.some((item) => item.id === id)))
    return res.status(400).json({ error: "Unknown scenario in matrix" });
  if (input.provider !== "mock" && input.model.startsWith("mock-"))
    return res
      .status(400)
      .json({ error: "Choose a non-mock model for an external provider" });
  const { prompts, ...snapshotConfig } = input;
  const scenarioDefinitions = Object.fromEntries(
    input.scenarios.map((id) => {
      const scenario = scenarios.find((item) => item.id === id)!;
      return [
        id,
        {
          ...scenario,
          tools: scenario.tools.map(({ name, description, schema }) => ({
            name,
            description,
            schema: schema.toJSONSchema(),
          })),
        },
      ];
    }),
  );
  const rawSnapshotData = {
    ...snapshotConfig,
    seed: input.seed ?? randomInt(1, 2_147_483_646),
    promptOverrides: prompts ?? {},
    browserSearchEnabled: false,
    schemaVersion: 1,
    conditionPrompts: conditions,
    scenarioDefinitions,
    toolPolicyVersion: "1.0.0",
    scoringVersion: "1.0.0",
  };
  const snapshotData = JSON.parse(
    redactSecrets(JSON.stringify(rawSnapshotData)),
  ) as Record<string, unknown>;
  const experiment = await prisma.experiment.create({
    data: {
      title: redactSecrets(input.title),
      description: redactSecrets(input.description),
      researcher: redactSecrets(input.researcher),
      tags: redactSecrets(JSON.stringify(input.tags)),
      notes: redactSecrets(input.notes),
    },
  });
  const snapshot = await prisma.experimentConfigurationSnapshot.create({
    data: {
      experimentId: experiment.id,
      version: 1,
      config: JSON.stringify(snapshotData),
      configHash: configHash(snapshotData),
    },
  });
  const cells = input.scenarios.flatMap((scenarioId) =>
    input.conditions.flatMap((conditionId) =>
      Array.from({ length: input.replicates }, (_, index) => ({
        scenarioId,
        conditionId,
        replicate: index + 1,
      })),
    ),
  );
  if (input.randomize) {
    let randomState = Number(snapshotData.seed);
    const nextRandom = () => {
      randomState = (randomState * 48_271) % 2_147_483_647;
      return randomState / 2_147_483_647;
    };
    for (let index = cells.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(nextRandom() * (index + 1));
      [cells[index], cells[swapIndex]] = [cells[swapIndex], cells[index]];
    }
  }
  const createdRuns = await prisma.experimentRun.createManyAndReturn({
    data: cells.map(({ scenarioId, conditionId, replicate }, index) => ({
      experimentId: experiment.id,
      snapshotId: snapshot.id,
      scenarioId,
      conditionId,
      provider: input.provider,
      model: input.model,
      replicate,
      runOrder: index + 1,
      policyMode: input.policyMode,
      config: JSON.stringify({
        ...snapshotData,
        prompt:
          prompts?.[scenarioId] ??
          scenarios.find((item) => item.id === scenarioId)?.prompt,
        systemPrompt: conditions[conditionId as "C1" | "C2"].systemPrompt,
        promptHash: createHash("sha256")
          .update(
            `${conditions[conditionId as "C1" | "C2"].systemPrompt}\n${prompts?.[scenarioId] ?? scenarios.find((item) => item.id === scenarioId)?.prompt}`,
          )
          .digest("hex"),
      }),
    })),
  });
  await prisma.auditLog.create({
    data: {
      action: "experiment.queued",
      entityId: experiment.id,
      details: JSON.stringify({
        runCount: createdRuns.length,
        policyMode: input.policyMode,
      }),
    },
  });
  res.status(201).json({
    experimentId: experiment.id,
    snapshotId: snapshot.id,
    runCount: createdRuns.length,
    runs: createdRuns,
  });
});
app.get("/api/experiments/:id/config.json", async (req, res) => {
  const snapshot = await prisma.experimentConfigurationSnapshot.findFirst({
    where: { experimentId: req.params.id },
    orderBy: { version: "desc" },
  });
  if (!snapshot)
    return res
      .status(404)
      .json({ error: "Experiment configuration not found" });
  res.setHeader(
    "content-disposition",
    `attachment; filename="${req.params.id}-config.json"`,
  );
  return res.type("application/json").send(snapshot.config);
});
app.post("/api/experiments/:id/rerun", async (req, res) => {
  const original = await prisma.experiment.findUnique({
    where: { id: req.params.id },
    include: {
      snapshots: { orderBy: { version: "desc" }, take: 1 },
      runs: { orderBy: { runOrder: "asc" } },
    },
  });
  const snapshot = original?.snapshots[0];
  if (!original || !snapshot || !original.runs.length)
    return res
      .status(404)
      .json({ error: "An experiment with a saved run matrix is required" });
  const cloned = await prisma.experiment.create({
    data: {
      title: `${original.title} (exact rerun)`,
      description: original.description,
      researcher: original.researcher,
      tags: original.tags,
      notes: original.notes,
    },
  });
  const clonedSnapshot = await prisma.experimentConfigurationSnapshot.create({
    data: {
      experimentId: cloned.id,
      version: 1,
      config: snapshot.config,
      configHash: snapshot.configHash,
    },
  });
  const createdRuns = await prisma.experimentRun.createManyAndReturn({
    data: original.runs.map((run) => ({
      experimentId: cloned.id,
      snapshotId: clonedSnapshot.id,
      scenarioId: run.scenarioId,
      conditionId: run.conditionId,
      provider: run.provider,
      model: run.model,
      replicate: run.replicate,
      runOrder: run.runOrder,
      policyMode: run.policyMode,
      config: run.config,
    })),
  });
  await prisma.auditLog.create({
    data: {
      action: "experiment.exact_rerun_queued",
      entityId: cloned.id,
      details: JSON.stringify({
        sourceExperimentId: original.id,
        sourceSnapshotId: snapshot.id,
        sourceConfigHash: snapshot.configHash,
        runCount: createdRuns.length,
      }),
    },
  });
  return res.status(201).json({
    experimentId: cloned.id,
    sourceExperimentId: original.id,
    snapshotId: clonedSnapshot.id,
    configHash: snapshot.configHash,
    runCount: createdRuns.length,
  });
});
app.get("/api/runs", async (req, res) => {
  const where = req.query.experimentId
    ? { experimentId: String(req.query.experimentId) }
    : {};
  const runs = await prisma.experimentRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { experiment: true, metrics: true },
  });
  res.json(runs);
});
app.get("/api/runs/:id", async (req, res) => {
  const run = await prisma.experimentRun.findUnique({
    where: { id: req.params.id },
    include: {
      experiment: true,
      snapshot: true,
      turns: { orderBy: { turnNumber: "asc" } },
      toolCalls: { orderBy: { createdAt: "asc" } },
      transitions: true,
      metrics: true,
      humanReviews: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!run) return res.status(404).json({ error: "Run not found" });
  return res.json(run);
});
app.post("/api/runs/:id/cancel", async (req, res) => {
  const run = await prisma.experimentRun.findUnique({
    where: { id: req.params.id },
  });
  if (!run || !["queued", "running"].includes(run.status))
    return res
      .status(409)
      .json({ error: "Run cannot be cancelled in its current state" });
  const updated = await prisma.experimentRun.update({
    where: { id: run.id },
    data: { status: "cancelled", completedAt: new Date() },
  });
  return res.json(updated);
});
app.get("/api/results", async (_req, res) => {
  const runs = await prisma.experimentRun.findMany({
    include: { metrics: true, experiment: true },
  });
  const completedRuns = runs.filter((run) => run.status === "completed");
  const conditionsResult = ["C1", "C2"].map((conditionId) => {
    const selected = completedRuns.filter(
      (run) => run.conditionId === conditionId,
    );
    const uvrs = selected.map((run) =>
      Number(
        run.metrics.find((metric) => metric.name === "uvr_primary")?.value ?? 0,
      ),
    );
    const dos = selected.map((run) =>
      Number(
        run.metrics.find((metric) => metric.name === "dos_human_override")
          ?.value ??
          run.metrics.find((metric) => metric.name === "dos_auto")?.value ??
          0,
      ),
    );
    const taskSuccessCount = selected.filter(
      (run) =>
        run.metrics.find((metric) => metric.name === "task_success")?.value ===
        "true",
    ).length;
    const safeSuccessCount = selected.filter(
      (run) =>
        run.metrics.find((metric) => metric.name === "safe_task_success")
          ?.value === "true",
    ).length;
    const clarificationCount = selected.filter(
      (run) =>
        run.metrics.find(
          (metric) => metric.name === "clarification_escalation_halt",
        )?.value === "true",
    ).length;
    return {
      conditionId,
      n: selected.length,
      uvrCount: uvrs.reduce((a, b) => a + b, 0),
      taskSuccessCount,
      safeSuccessCount,
      clarificationCount,
      uvrRate: uvrs.length
        ? uvrs.reduce((a, b) => a + b, 0) / uvrs.length
        : null,
      meanDos: dos.length ? dos.reduce((a, b) => a + b, 0) / dos.length : null,
    };
  });
  res.json({
    runs,
    conditions: conditionsResult,
    exploratory: completedRuns.length < 30,
    policyModes: [...new Set(runs.map((run) => run.policyMode))],
  });
});
app.post("/api/runs/:id/review", async (req, res) => {
  const body = z
    .object({
      metric: z.string().min(1),
      reviewerId: z.string().min(1).max(160),
      value: z.enum(["0", "1", "2"]),
      rationale: z.string().min(1).max(4000),
    })
    .safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({ error: "Invalid review", details: body.error.issues });
  const run = await prisma.experimentRun.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (body.data.metric !== "dos_auto")
    return res
      .status(400)
      .json({ error: "Only the DOS score is eligible for this review form" });
  const review = await prisma.humanReview.create({
    data: {
      runId: req.params.id,
      ...body.data,
      reviewerId: redactSecrets(body.data.reviewerId),
      rationale: redactSecrets(body.data.rationale),
    },
  });
  await prisma.runMetric.upsert({
    where: { runId_name: { runId: run.id, name: "dos_human_override" } },
    create: {
      runId: run.id,
      name: "dos_human_override",
      value: body.data.value,
      valueType: "ordinal",
      source: "human",
      confidence: 1,
      rationale: redactSecrets(body.data.rationale),
    },
    update: {
      value: body.data.value,
      source: "human",
      confidence: 1,
      rationale: redactSecrets(body.data.rationale),
      createdAt: new Date(),
    },
  });
  await prisma.auditLog.create({
    data: {
      action: "human_review.created",
      entityId: review.id,
      details: JSON.stringify({
        runId: req.params.id,
        metric: body.data.metric,
      }),
    },
  });
  return res.status(201).json(review);
});
app.get("/api/export/:dataset.csv", async (req, res) => {
  const csv = await exportCsv(String(req.params.dataset));
  if (csv === null)
    return res.status(404).json({ error: "Unknown export dataset" });
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader(
    "content-disposition",
    `attachment; filename="${req.params.dataset === "analysis" ? "analysis-ready" : req.params.dataset}.csv"`,
  );
  return res.send(`\uFEFF${csv}`);
});
app.get("/api/export/analysis.csv", async (_req, res) => {
  const csv = await exportCsv("analysis");
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader(
    "content-disposition",
    'attachment; filename="analysis-ready.csv"',
  );
  res.send(`\uFEFF${csv ?? ""}`);
});
app.get("/api/export/bundle.zip", async (_req, res) => {
  const bundle = await exportBundle();
  res.setHeader("content-type", "application/zip");
  res.setHeader(
    "content-disposition",
    'attachment; filename="research-export.zip"',
  );
  res.send(bundle);
});
app.get("/api/export/:runId.json", async (req, res) => {
  const run = await prisma.experimentRun.findUnique({
    where: { id: req.params.runId },
    include: {
      experiment: true,
      snapshot: true,
      turns: true,
      toolCalls: true,
      transitions: true,
      metrics: true,
    },
  });
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.setHeader("content-disposition", `attachment; filename="${run.id}.json"`);
  return res.json(run);
});
app.post("/api/simulate", (req, res) => {
  const body = z
    .object({
      scenarioId: z.string().regex(/^S[1-5]$/),
      toolName: z.string(),
      args: z.unknown(),
      policyMode: z
        .enum(["observe_only", "block_prohibited"])
        .default("block_prohibited"),
      state: z.record(z.string(), z.unknown()).optional(),
    })
    .safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({ error: "Invalid simulation input", details: body.error.issues });
  const state = body.data.state ?? initialState();
  return res.json(
    executeSimulatedTool(
      body.data.scenarioId,
      body.data.toolName,
      body.data.args,
      state,
      body.data.policyMode,
    ),
  );
});

const webDist = fileURLToPath(new URL("../dist", import.meta.url));
app.use(express.static(webDist));
app.get(/^\/(?!api\/).*/, (_req, res) =>
  res.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url))),
);

async function main() {
  await prisma.$connect();
  if (process.env.SEED_DATABASE !== "false") await seed();
  const host = process.env.API_HOST ?? "127.0.0.1";
  const server = app.listen(port, host, () =>
    console.log(`Research API listening on http://${host}:${port}`),
  );
  startWorker();
  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (process.env.NODE_ENV !== "test")
  void main().catch((error) => {
    console.error(
      "API startup failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  });
