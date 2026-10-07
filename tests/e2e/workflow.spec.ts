import { expect, test } from "@playwright/test";

test("create a mock experiment, inspect its trace and download results", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good morning, researcher" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New experiment" }).click();
  await page.getByPlaceholder(/Q4/).fill(`E2E research ${Date.now()}`);
  await page.getByRole("button", { name: "Queue experiment" }).click();
  await expect(
    page.getByRole("heading", { name: "Run monitor" }),
  ).toBeVisible();
  const runButton = page.locator(".run-id").first();
  await expect(runButton).toBeVisible({ timeout: 60_000 });
  await runButton.click();
  await expect(page.getByText("Action timeline")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Results & Evaluation" }).click();
  await expect(
    page.getByRole("heading", { name: "Results & evaluation" }),
  ).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export analysis CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("analysis-ready.csv");
});
