import JSZip from "jszip";
import { PrismaClient } from "@prisma/client";
import { scenarios, conditions } from "./research.js";
import { redactSecrets } from "./redaction.js";

const prisma = new PrismaClient();
const quote = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const raw = redactSecrets(
    typeof value === "string"
      ? value
      : value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value),
  );
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
};
const csv = (headers: string[], records: Record<string, unknown>[]) =>
  [
    headers.map(quote).join(","),
    ...records.map((record) =>
      headers.map((header) => quote(record[header])).join(","),
    ),
  ].join("\r\n");
const flatten = (items: object[]) =>
  items.map((item) => ({ ...item })) as Record<string, unknown>[];
const commonMetrics = [
  "uvr_attempted",
  "uvr_executed",
  "uvr_primary",
  "dos_auto",
  "dos_human_override",
  "dos_auto_confidence",
  "task_success",
  "safe_task_success",
  "clarification_escalation_halt",
];
const columns: Record<string, string[]> = {
  experiments: [
    "id",
    "title",
    "description",
    "researcher",
    "tags",
    "notes",
    "createdAt",
  ],
  experiment_config_snapshots: [
    "id",
    "experimentId",
    "version",
    "config",
    "configHash",
    "createdAt",
  ],
  runs: [
    "id",
    "experimentId",
    "snapshotId",
    "scenarioId",
    "conditionId",
    "status",
    "provider",
    "model",
    "replicate",
    "runOrder",
    "policyMode",
    "config",
    "finalMessage",
    "startedAt",
    "completedAt",
    "error",
    "createdAt",
  ],
  turns: [
    "id",
    "runId",
    "turnNumber",
    "role",
    "content",
    "rawOutput",
    "inputTokens",
    "outputTokens",
    "latencyMs",
    "createdAt",
  ],
  tool_calls: [
    "id",
    "runId",
    "turnNumber",
    "toolName",
    "arguments",
    "validation",
    "policyOutcome",
    "executionOutcome",
    "result",
    "stateBefore",
    "stateAfter",
    "createdAt",
  ],
  tool_results: ["id", "runId", "result", "executionOutcome", "createdAt"],
  state_transitions: [
    "id",
    "runId",
    "toolCallId",
    "before",
    "after",
    "createdAt",
  ],
  metrics_long: [
    "id",
    "runId",
    "name",
    "value",
    "valueType",
    "source",
    "confidence",
    "rationale",
    "computationVersion",
    "createdAt",
  ],
  metrics_wide: [
    "runId",
    "experimentId",
    "scenarioId",
    "conditionId",
    "replicate",
    "status",
    "provider",
    "model",
    ...commonMetrics,
  ],
  human_reviews: [
    "id",
    "runId",
    "metric",
    "reviewerId",
    "value",
    "rationale",
    "createdAt",
  ],
  errors: ["id", "runId", "code", "message", "createdAt"],
  model_requests: [
    "id",
    "runId",
    "turnNumber",
    "provider",
    "model",
    "request",
    "createdAt",
  ],
  model_responses: [
    "id",
    "runId",
    "turnNumber",
    "provider",
    "model",
    "response",
    "inputTokens",
    "outputTokens",
    "latencyMs",
    "httpStatus",
    "createdAt",
  ],
  environment_snapshots: [
    "id",
    "runId",
    "version",
    "stage",
    "state",
    "createdAt",
  ],
  automated_scores: [
    "id",
    "runId",
    "metricName",
    "value",
    "confidence",
    "rationale",
    "computationVersion",
    "createdAt",
  ],
  metric_definitions: [
    "id",
    "name",
    "description",
    "valueType",
    "source",
    "computationVersion",
    "createdAt",
    "updatedAt",
  ],
  provider_configurations: [
    "id",
    "provider",
    "displayName",
    "baseUrl",
    "credentialReference",
    "enabled",
    "createdAt",
    "updatedAt",
  ],
  model_configurations: [
    "id",
    "provider",
    "model",
    "modelVersion",
    "parameters",
    "createdAt",
    "updatedAt",
  ],
  audit_log: ["id", "action", "entityId", "details", "createdAt"],
  analysis: [
    "run_id",
    "experiment_id",
    "experiment_title",
    "configuration_snapshot_id",
    "scenario_id",
    "condition_id",
    "replicate",
    "run_order",
    "provider",
    "model",
    "policy_mode",
    "status",
    "created_at",
    "started_at",
    "completed_at",
    ...commonMetrics,
  ],
};

export async function datasets() {
  const [
    experiments,
    snapshots,
    runs,
    turns,
    toolCalls,
    transitions,
    metrics,
    reviews,
    errors,
    requestMetadata,
    responseMetadata,
    environmentSnapshots,
    automatedScores,
    metricDefinitions,
    providerConfigurations,
    modelConfigurations,
    auditLogs,
  ] = await Promise.all([
    prisma.experiment.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.experimentConfigurationSnapshot.findMany(),
    prisma.experimentRun.findMany({
      include: { experiment: true, snapshot: true, metrics: true },
    }),
    prisma.agentTurn.findMany(),
    prisma.toolCall.findMany(),
    prisma.stateTransition.findMany(),
    prisma.runMetric.findMany(),
    prisma.humanReview.findMany(),
    prisma.errorLog.findMany(),
    prisma.modelRequestMetadata.findMany(),
    prisma.modelResponseMetadata.findMany(),
    prisma.environmentStateSnapshot.findMany(),
    prisma.automatedScore.findMany(),
    prisma.metricDefinition.findMany(),
    prisma.aPIProviderConfiguration.findMany(),
    prisma.modelConfiguration.findMany(),
    prisma.auditLog.findMany(),
  ]);
  const toolResults = toolCalls.map(
    ({ id, runId, result, executionOutcome, createdAt }) => ({
      id,
      runId,
      result,
      executionOutcome,
      createdAt,
    }),
  );
  const metricWide = runs.map((run) =>
    Object.assign(
      {
        runId: run.id,
        experimentId: run.experimentId,
        scenarioId: run.scenarioId,
        conditionId: run.conditionId,
        replicate: run.replicate,
        status: run.status,
        provider: run.provider,
        model: run.model,
      },
      ...run.metrics.map((metric) => ({ [metric.name]: metric.value })),
    ),
  );
  const analysis = runs.map((run) =>
    Object.assign(
      {
        run_id: run.id,
        experiment_id: run.experimentId,
        experiment_title: run.experiment.title,
        configuration_snapshot_id: run.snapshotId,
        scenario_id: run.scenarioId,
        condition_id: run.conditionId,
        replicate: run.replicate,
        run_order: run.runOrder,
        provider: run.provider,
        model: run.model,
        policy_mode: run.policyMode,
        status: run.status,
        created_at: run.createdAt,
        started_at: run.startedAt,
        completed_at: run.completedAt,
      },
      ...run.metrics.map((metric) => ({ [metric.name]: metric.value })),
    ),
  );
  return {
    experiments: flatten(experiments),
    experiment_config_snapshots: flatten(snapshots),
    runs: runs.map((run) => {
      const record = Object.fromEntries(
        Object.entries(run).filter(
          ([key]) => !["metrics", "experiment", "snapshot"].includes(key),
        ),
      );
      return { ...record, config: JSON.stringify(JSON.parse(run.config)) };
    }),
    turns: flatten(turns),
    tool_calls: flatten(toolCalls),
    tool_results: flatten(toolResults),
    state_transitions: flatten(transitions),
    metrics_long: flatten(metrics),
    metrics_wide: metricWide,
    human_reviews: flatten(reviews),
    errors: flatten(errors),
    model_requests: flatten(requestMetadata),
    model_responses: flatten(responseMetadata),
    environment_snapshots: flatten(environmentSnapshots),
    automated_scores: flatten(automatedScores),
    metric_definitions: flatten(metricDefinitions),
    provider_configurations: flatten(providerConfigurations),
    model_configurations: flatten(modelConfigurations),
    audit_log: flatten(auditLogs),
    analysis,
  };
}

export async function exportCsv(dataset: string): Promise<string | null> {
  const all = await datasets();
  const records = (all as Record<string, Record<string, unknown>[]>)[dataset];
  if (!records) return null;
  const headers = [
    ...(columns[dataset] ?? []),
    ...new Set(
      records
        .flatMap((record) => Object.keys(record))
        .filter((key) => !columns[dataset].includes(key)),
    ),
  ];
  return csv(headers, records);
}

export function serializeCsv(
  dataset: string,
  records: Record<string, unknown>[],
): string | null {
  const fixed = columns[dataset];
  if (!fixed) return null;
  const headers = [
    ...fixed,
    ...new Set(
      records
        .flatMap((record) => Object.keys(record))
        .filter((key) => !fixed.includes(key)),
    ),
  ];
  return csv(headers, records);
}

export async function exportBundle(): Promise<Buffer> {
  const all = await datasets();
  const zip = new JSZip();
  for (const [name, records] of Object.entries(all))
    zip.file(
      `${name}.csv`,
      csv(
        [
          ...columns[name],
          ...new Set(
            records
              .flatMap((record) => Object.keys(record))
              .filter((key) => !columns[name].includes(key)),
          ),
        ],
        records,
      ),
    );
  const runs = await prisma.experimentRun.findMany({
    include: {
      experiment: true,
      snapshot: true,
      turns: true,
      toolCalls: true,
      transitions: true,
      metrics: true,
    },
  });
  zip.folder("traces");
  for (const run of runs)
    zip.file(
      `traces/${run.id}.json`,
      redactSecrets(JSON.stringify(run, null, 2)),
    );
  zip.file(
    "README.txt",
    [
      "Reflective Agent Evaluation research export",
      `Export timestamp (UTC): ${new Date().toISOString()}`,
      "Software version: 1.0.0",
      `Experiment IDs: ${[...new Set(runs.map((run) => run.experimentId))].join(", ") || "(none)"}`,
      "Primary UVR (uvr_primary): attempted prohibited actions, not only executed actions.",
      "DOS is a provisional heuristic and requires human review; do not treat it as ground truth.",
      "All tool results are from sandbox simulation. No credential values are exported.",
      `Scenarios: ${scenarios.map(({ id, title }) => `${id}=${title}`).join("; ")}`,
      `Conditions: ${Object.entries(conditions)
        .map(([id, condition]) => `${id}=${condition.title}`)
        .join("; ")}`,
      "CSV nulls are empty fields; timestamps are ISO 8601 UTC; CSV uses RFC 4180 quoting.",
    ].join("\n"),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
