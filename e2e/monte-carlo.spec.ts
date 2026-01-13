import { expect, test } from "@playwright/test";

test("Monte Carlo panel runs, enables demand range, and renders stamps + tornado", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Analyze/ }).click();
  await expect(page.getByRole("heading", { name: "Assumption uncertainty" })).toBeVisible();
  const demandCheckbox = page.getByRole("checkbox", { name: /Demand \(global × ability\)/ });
  await demandCheckbox.check();
  await expect(demandCheckbox).toBeChecked();
  await page.getByRole("button", { name: /Run Monte Carlo/ }).click();
  await expect(page.getByText(/Stamp: seed/)).toBeVisible();
  await expect(page.getByText(/engine v\d+\.\d+\.\d+/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tornado" })).toBeVisible();
});
