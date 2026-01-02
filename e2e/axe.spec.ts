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
