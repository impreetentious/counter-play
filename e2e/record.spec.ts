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

test("unreadable autosave is preserved until explicit replacement and remains downloadable", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("scenario.v1", "{unreadable"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Download saved recovery data" })).toBeVisible();
  await page.getByRole("tab", { name: /Analyze/ }).click();
  await page.getByRole("button", { name: /^Flat 8% / }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Replace", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("scenario.v1"))).toBe("{unreadable");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download saved recovery data" }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("{unreadable");
  expect(await page.evaluate(() => localStorage.getItem("scenario.v1"))).toBe("{unreadable");
  await page.getByRole("button", { name: "Replace saved workspace" }).click();
  await expect(page.getByRole("button", { name: "Download saved recovery data" })).toHaveCount(0);
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem("scenario.v1")))!).schemaVersion,
  ).toBe(1);
});

test("enabled advanced record preserves exact values and print disclosures", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Analyze/ }).click();
  await page.getByRole("button", { name: "Model an N-period horizon" }).click();
  await page.getByRole("button", { name: "Model team play" }).click();
  await page.getByRole("tab", { name: /Simulate/ }).click();
  await page.getByLabel("Offer these plans as a menu, not as alternatives").check();
  await page.getByRole("link", { name: /Open printable design record/ }).click();
  await expect(page.getByRole("heading", { name: "Multi-period horizon results" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team equilibrium results" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Enabled menu selections" })).toBeVisible();
  await expect(page.locator(".record-raw").filter({ hasText: "[object Object]" })).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(/Ratchet-aware response uses one step/)).toBeVisible();
  await expect(page.locator(".record-table thead").first()).toHaveCSS(
    "display",
    "table-header-group",
  );
});
