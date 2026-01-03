import { expect, test } from "@playwright/test";

test("simulate surface runs, switches modes, and shows the identity badge", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Simulate/ }).click();
  await expect(page.getByRole("heading", { name: "Best-response outcomes" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Identity attested");

  await page.getByRole("button", { name: "Stochastic (CARA)" }).click();
  await expect(page.getByRole("status")).toContainText("mode stochastic");

  await page.getByRole("button", { name: "Deterministic" }).click();
  await expect(page.getByRole("status")).toContainText("mode deterministic");
});
