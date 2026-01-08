import { expect, test } from "@playwright/test";

test.describe("workspace P4", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("model + design editors persist and validate exactly", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Rep population assumptions" })).toBeVisible();

    await expect(page.locator(".population-summary")).toContainText("18 reps total");
    const seniorCount = page.locator("#segment-seg-3-count");
    await seniorCount.fill("7");
    await expect(page.locator(".population-summary")).toContainText("21 reps total");

    await page.getByRole("tab", { name: /Design/ }).click();
    await expect(page.getByRole("heading", { name: "Plan structure and payout preview" })).toBeVisible();
    const firstTierRate = page.locator("#plan-plan-1-tier-0-rate");
    await firstTierRate.fill("not-a-number");
    await expect(page.locator(".surface-error")).toBeVisible();
    await firstTierRate.fill("0.07");
    await expect(page.locator(".surface-error")).toHaveCount(0);

    await page.reload();
    await page.getByRole("tab", { name: /Model/ }).click();
    await expect(page.locator("#segment-seg-3-count")).toHaveValue("7");
  });

  test("the V-02 rationality dial switches the response class and persists", async ({ page }) => {
    await page.goto("/");
    const bounded = page.getByRole("button", { name: "Bounded (softmax)" });
    await expect(bounded).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#rationality-tau")).toHaveCount(0);

    await bounded.click();
    await expect(bounded).toHaveAttribute("aria-pressed", "true");
    const tau = page.locator("#rationality-tau");
    await expect(tau).toHaveValue("5000");
    await tau.fill("12000");

    await page.getByRole("tab", { name: /Simulate/ }).click();
    await expect(page.locator(".response-table caption").first()).toContainText("bounded responses");
    await expect(page.getByRole("columnheader", { name: "CE gap" }).first()).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: /Model/ }).click();
    await expect(page.locator("#rationality-tau")).toHaveValue("12000");

    await page.getByRole("button", { name: "Exact best response" }).click();
    await expect(page.locator("#rationality-tau")).toHaveCount(0);
  });

  test("template picker asks before replacing a customised scenario", async ({ page }) => {
    await page.goto("/");
    await page.locator("#segment-seg-1-label").fill("Junior team");
    await page.getByRole("button", { name: "Bonus + cap" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Replace" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#segment-seg-1-label")).toHaveValue("Junior");
  });
});
