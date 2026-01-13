import { expect, test } from "@playwright/test";

test("the static shell renders and its theme control works", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Counterplay" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Model/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  await page.getByRole("tab", { name: /Design/ }).click();
  await expect(
    page.getByRole("heading", { name: "Plan structure and payout preview" }),
  ).toBeVisible();
});
