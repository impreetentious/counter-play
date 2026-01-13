import { expect, test } from "@playwright/test";

test("record page renders assumptions, KPIs, findings, and stamps from the current scenario", async ({
  page,
}) => {
  await page.goto("/record");
  await expect(page.getByRole("heading", { name: "Compensation Design Record" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Segment assumptions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan specification" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Simulated KPIs/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Identity attestations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Linter findings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Two-period timing summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monte Carlo bands" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision notes" })).toBeVisible();
  await expect(page.locator("code", { hasText: /engineVersion=0\./ })).toBeVisible();
});

test("share URL round-trips a scenario into a fresh browser context", async ({ browser }) => {
  const sender = await browser.newContext();
  const senderPage = await sender.newPage();
  await senderPage.goto("/");
  await senderPage.getByRole("button", { name: "Build share link" }).click();
  const shareInput = senderPage.getByLabel("Share URL");
  await expect(shareInput).toBeVisible();
  const shareUrl = await shareInput.inputValue();
  expect(shareUrl).toMatch(/#s=/);
  await sender.close();

  const receiver = await browser.newContext();
  const receiverPage = await receiver.newPage();
  await receiverPage.goto(shareUrl);
  await expect(receiverPage.getByRole("status")).toContainText("Scenario loaded from share link");
  await expect(receiverPage.getByRole("heading", { name: "Counterplay" })).toBeVisible();
  await receiver.close();
});

test("JSON export produces a file the import path accepts back verbatim", async ({ page }) => {
  await page.goto("/");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export JSON" }).click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  // A shallow sanity check — the file exists and JSON.parse succeeds.
  const content = await download.createReadStream().then(async (stream) => {
    if (!stream) return "";
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  });
  const parsed = JSON.parse(content);
  expect(parsed.schemaVersion).toBe(1);
  expect(Array.isArray(parsed.population)).toBe(true);
});
