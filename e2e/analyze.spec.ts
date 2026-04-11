import { expect, test } from "@playwright/test";

test("analyze surface shows findings on a bonus + cap template", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Bonus + cap" }).click();
  await page.getByRole("button", { name: "Replace" }).click();
  await page.getByRole("tab", { name: /Analyze/ }).click();
  await expect(page.getByRole("heading", { name: "Perverse-incentive findings" })).toBeVisible();
  await expect(page.locator(".finding-card")).toHaveCount(1);
  await expect(page.locator(".finding-card")).not.toContainText("undefined");
});

test("clean template shows the empty-findings state", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Flat 8%" }).click();
  await page.getByRole("button", { name: "Replace" }).click();
  await page.getByRole("tab", { name: /Analyze/ }).click();
  await expect(page.locator(".empty-findings")).toBeVisible();
  await page.getByRole("button", { name: "Tight cap" }).click();
  await expect(page.getByText("L-3", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /Show me: Design/ }).click();
  await expect(page.getByRole("tab", { name: "Design" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("deep-link-highlight-target")).toBeVisible();
});
