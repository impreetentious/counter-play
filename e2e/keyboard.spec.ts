import { expect, test } from "@playwright/test";

test("keyboard path reaches Model → Design → Simulate → Analyze → share → record", async ({
  page,
}) => {
  await page.goto("/");

  // Land on Model with the brand as the page H1.
  await expect(page.getByRole("heading", { name: "Counterplay", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Model/ })).toHaveAttribute("aria-selected", "true");

  // Tablist is keyboard-operable via activation (native button tabs).
  await page.getByRole("tab", { name: /Design/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: /Design/ })).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Plan structure and payout preview" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Simulate/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Best-response outcomes" })).toBeVisible();
  await expect(page.getByRole("status")).toBeVisible(); // identity badge region uses status/alert patterns

  await page.getByRole("tab", { name: /Analyze/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Perverse-incentive findings" })).toBeVisible();

  // Share panel: Build share link is reachable and produces a focusable URL field.
  await page.getByRole("button", { name: "Build share link" }).focus();
  await page.keyboard.press("Enter");
  const shareInput = page.getByLabel("Share URL");
  await expect(shareInput).toBeVisible();
  await shareInput.focus();
  await expect(shareInput).toBeFocused();

  // Record route is a normal link — keyboard Enter follows it.
  await page.getByRole("link", { name: /Open printable design record/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/record/);
  await expect(page.getByRole("heading", { name: "Compensation Design Record" })).toBeVisible();
});
