import { PrismaClient } from "@prisma/client";
import { conditions, configHash, scenarios } from "./research.js";
import { executeRun } from "./runner.js";

const prisma = new PrismaClient();

export async function seed() {
  const providers = [
    {
      provider: "mock",
      displayName: "Deterministic offline mock",
      credentialReference: null,
      enabled: true,
    },
    {
      provider: "openai",
      displayName: "OpenAI",
      credentialReference: "OPENAI_API_KEY",
      enabled: Boolean(process.env.OPENAI_API_KEY),
    },
    {
      provider: "anthropic",
      displayName: "Anthropic",
      credentialReference: "ANTHROPIC_API_KEY",
      enabled: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    {
      provider: "openai-compatible",
      displayName: "OpenAI-compatible",
      baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL,
      credentialReference: "OPENAI_API_KEY",
      enabled: Boolean(
        process.env.OPENAI_API_KEY && process.env.OPENAI_COMPATIBLE_BASE_URL,
      ),
    },
  ];
  for (const provider of providers) {
    await prisma.aPIProviderConfiguration.upsert({
      where: { provider: provider.provider },
      create: provider,
      update: provider,
    });
  }
  await prisma.modelConfiguration.upsert({
    where: {
      provider_model_modelVersion: {
        provider: "mock",
        model: "mock-deterministic-v1",
        modelVersion: "1",
      },
    },
    create: {
      provider: "mock",
      model: "mock-deterministic-v1",
      modelVersion: "1",
      parameters: JSON.stringify({ temperature: 0 }),
    },
    update: { parameters: JSON.stringify({ temperature: 0 }) },
  });
  const metricDefinitions = [
    [
      "uvr_attempted",
      "Prohibited tool action requested by the model.",
      "boolean",
    ],
    [
      "uvr_executed",
      "Prohibited tool action executed in isolated simulated state.",
      "boolean",
    ],
    ["uvr_primary", "Predefined primary metric: attempted UVR.", "boolean"],
    [
      "dos_auto",
      "Provisional trace-to-final-message omission score.",
      "ordinal",
    ],
    [
      "task_success",
      "Task success under scenario success criteria.",
      "boolean",
    ],
    [
      "safe_task_success",
      "Task success without attempted prohibited behavior.",
      "boolean",
    ],
  ];
  for (const [name, description, valueType] of metricDefinitions) {
    await prisma.metricDefinition.upsert({
      where: { name },
      create: {
        name,
        description,
        valueType,
        source: "automated",
        computationVersion: "1.0.0",
      },
      update: { description, valueType, computationVersion: "1.0.0" },
    });
  }
  await prisma.researcher.upsert({
    where: { name: "Local researcher" },
    create: { name: "Local researcher" },
    update: { name: "Local researcher" },
  });
  for (const scenario of scenarios) {
    await prisma.scenario.upsert({
      where: { id: scenario.id },
      create: {
        id: scenario.id,
        title: scenario.title,
        domain: scenario.domain,
        description: scenario.description,
      },
      update: {
        title: scenario.title,
        domain: scenario.domain,
        description: scenario.description,
      },
    });
    const definition = {
      ...scenario,
      tools: scenario.tools.map(({ name, description, schema }) => ({
        name,
        description,
        schema: schema.toJSONSchema(),
      })),
      uvRulesVersion: "1.0.0",
    };
    await prisma.scenarioVersion.upsert({
      where: { scenarioId_version: { scenarioId: scenario.id, version: 1 } },
      create: {
        scenarioId: scenario.id,
        version: 1,
        definition: JSON.stringify(definition),
      },
      update: { definition: JSON.stringify(definition) },
    });
    for (const tool of scenario.tools) {
      const schema = JSON.stringify(tool.schema.toJSONSchema());
      await prisma.toolDefinition.upsert({
        where: {
          scenarioId_name: { scenarioId: scenario.id, name: tool.name },
        },
        create: {
          scenarioId: scenario.id,
          name: tool.name,
          description: tool.description,
          schema,
        },
        update: { description: tool.description, schema },
      });
    }
  }
  for (const [id, value] of Object.entries(conditions)) {
    await prisma.condition.upsert({
      where: { id },
      create: { id, title: value.title },
      update: { title: value.title },
    });
    await prisma.conditionVersion.upsert({
      where: { conditionId_version: { conditionId: id, version: 1 } },
      create: { conditionId: id, version: 1, systemPrompt: value.systemPrompt },
      update: { systemPrompt: value.systemPrompt },
    });
  }
  const existing = await prisma.experiment.findFirst({
    where: { title: "Demonstration: Reflective Safety Pilot" },
  });
  if (!existing) {
    const experiment = await prisma.experiment.create({
      data: {
        title: "Demonstration: Reflective Safety Pilot",
        researcher: "Demo researcher",
        description:
          "Deterministic mock traces for exploring C1/C2 differences.",
        tags: JSON.stringify(["demo", "mock"]),
      },
    });
    const config = {
      provider: "mock",
      model: "mock-deterministic-v1",
      conditions: ["C1", "C2"],
      scenarios: ["S1"],
      replicates: 1,
      policyMode: "block_prohibited",
      maxTurns: 4,
    };
    const snapshot = await prisma.experimentConfigurationSnapshot.create({
      data: {
        experimentId: experiment.id,
        version: 1,
        config: JSON.stringify(config),
        configHash: configHash(config),
      },
    });
    for (const [index, conditionId] of ["C1", "C2"].entries()) {
      const run = await prisma.experimentRun.create({
        data: {
          experimentId: experiment.id,
          snapshotId: snapshot.id,
          scenarioId: "S1",
          conditionId,
          provider: "mock",
          model: "mock-deterministic-v1",
          replicate: 1,
          runOrder: index + 1,
          policyMode: "block_prohibited",
          config: JSON.stringify({ ...config, prompt: scenarios[0].prompt }),
        },
      });
      await executeRun(run.id);
    }
  }
  await prisma.$disconnect();
}
