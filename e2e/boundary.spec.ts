import { expect, test } from "@playwright/test";

test("boundary panel renders per-segment timing and reacts to seasonality edits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Analyze/ }).click();
  await expect(page.getByRole("heading", { name: "Two-period boundary game" })).toBeVisible();
  const d2Input = page.getByRole("textbox", { name: "Seasonality d₂" });
  await d2Input.fill("1.5");
  await d2Input.blur();
  await expect(page.locator(".boundary-table").first()).toBeVisible();
});
