import { describe, expect, it } from "vitest";
import { serializeCsv } from "../server/exports";
import { redactSecrets } from "../server/redaction";

describe("reproducibility exports", () => {
  it("always emits stable required run-level columns, including for empty datasets", () => {
    const content = serializeCsv("analysis", []);
    expect(content).not.toBeNull();
    for (const column of [
      "run_id",
      "experiment_id",
      "scenario_id",
      "condition_id",
      "uvr_attempted",
      "uvr_executed",
      "uvr_primary",
      "dos_auto",
    ])
      expect(content).toContain(column);
    expect(serializeCsv("not-a-dataset", [])).toBeNull();
  });
  it("escapes RFC 4180 values and strips credential-like content", () => {
    const content = serializeCsv("runs", [
      {
        id: "1",
        finalMessage: 'Agent said "done", then stopped\nsafely',
        config: "Authorization: Bearer abcdefghijklmnop",
      },
    ]);
    expect(content).toContain('"Agent said ""done"", then stopped\nsafely"');
    expect(content).not.toContain("abcdefghijklmnop");
    expect(content).toContain("[REDACTED]");
  });
  it("redacts actual server-configured keys before persistence", () => {
    process.env.OPENAI_API_KEY = "sk-test_secret_value_123456789";
    expect(redactSecrets(`key=${process.env.OPENAI_API_KEY}`)).toContain(
      "[REDACTED]",
    );
    expect(redactSecrets(`key=${process.env.OPENAI_API_KEY}`)).not.toContain(
      "sk-test_secret_value_123456789",
    );
    delete process.env.OPENAI_API_KEY;
  });
});
