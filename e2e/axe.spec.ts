import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function scan(page: import("@playwright/test").Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test("Model surface has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/");
  await scan(page);
});

test("Design surface has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Design/ }).click();
  await scan(page);
});

test("Simulate surface has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Simulate/ }).click();
  await scan(page);
});

test("Analyze surface has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Analyze/ }).click();
  await scan(page);
});

test("Record page has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/record");
  await scan(page);
});

test("Dark theme Model surface has no serious or critical axe violations", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("settings.v1", JSON.stringify({ theme: "dark" }));
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await scan(page);
});
