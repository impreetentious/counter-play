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
    await expect(
      page.getByRole("heading", { name: "Plan structure and payout preview" }),
    ).toBeVisible();
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
    await expect(page.locator(".response-table caption").first()).toContainText(
      "bounded responses",
    );
    await expect(page.getByRole("columnheader", { name: "CE gap" }).first()).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: /Model/ }).click();
    await expect(page.locator("#rationality-tau")).toHaveValue("12000");

    await page.getByRole("button", { name: "Exact best response" }).click();
    await expect(page.locator("#rationality-tau")).toHaveCount(0);
  });

  test("the V-03 second task adds a task split and a value-efficiency reading", async ({
    page,
  }) => {
    await page.goto("/");
    const add = page.getByRole("button", { name: "Add second task" }).first();
    await expect(add).toHaveAttribute("aria-pressed", "false");
    await add.click();

    await page.getByRole("tab", { name: /Simulate/ }).click();
    await expect(page.getByRole("columnheader", { name: "Task split" }).first()).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Value efficiency" }).first(),
    ).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: /Model/ }).click();
    await expect(page.getByRole("button", { name: "Remove second task" }).first()).toBeVisible();
  });

  test("the V-04 horizon and V-05 team panels switch on and report", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: /Analyze/ }).click();

    await page.getByRole("button", { name: "Model an N-period horizon" }).click();
    await expect(page.getByRole("button", { name: "Ratchet-aware" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.locator("table.boundary-table caption").filter({ hasText: "quota path" }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Model team play" }).click();
    await expect(page.getByRole("button", { name: "Split credit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByRole("columnheader", { name: "Equilibrium effort" }).first(),
    ).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: /Analyze/ }).click();
    await expect(page.getByRole("button", { name: "Turn off the horizon" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Turn off team play" })).toBeVisible();
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

  test("V-08 curve handles, V-09 history, and V-10 locale controls remain keyboard-operable", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: /Design/ }).click();
    const rate = page.locator("#plan-plan-1-tier-0-rate");
    await expect(rate).toHaveValue("0.05");
    const handle = page.locator(".chart-rate-handle").first();
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await expect(rate).toHaveValue("0.055");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(rate).toHaveValue("0.05");
    await page.getByLabel("Display language").selectOption("de-DE");
    await expect(page.getByRole("button", { name: "Rückgängig" })).toBeVisible();
  });

  test("V-06 local search and V-07 calibration stay client-side and require explicit apply", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: /Analyze/ }).click();
    await page.getByRole("button", { name: "Explore local rates" }).click();
    await expect(page.locator(".optimizer-panel")).toContainText(/No feasible|Candidate:/);

    await page.getByLabel("Import attainment CSV").setInputFiles({
      name: "attainment.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("segment,attainment\nseg-1,0.9\nseg-1,1.1\n"),
    });
    await expect(page.locator(".calibration-panel")).toContainText("2 local historical rows read");
    await expect(page.getByRole("button", { name: "Apply usable proposals" })).toBeVisible();
  });
});
