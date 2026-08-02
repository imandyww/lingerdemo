import { expect, test } from "@playwright/test";

test("completes the exact credential-free memory to family conversation loop", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Start the conversation" }).click();
  for (let line = 1; line <= 4; line += 1) {
    const button = page.getByTestId("demo-next-turn");
    await expect(button).toBeEnabled();
    await button.click();
  }
  await expect(page.getByText("No. But I still remember Ming standing there in the rain.")).toBeVisible();
  await page.getByTestId("simulate-extraction").click();
  await expect(page.getByTestId("extraction-title")).toHaveValue("The day I left home");
  await expect(page.getByText("Known birth year 1951 + directly stated age seventeen = 1968.")).toBeVisible();
  await page.getByTestId("confirm-memory").click();
  await expect(page.getByText("Memory saved with consent", { exact: true })).toBeVisible();
  await page.getByTestId("view-saved-story").click();
  await expect(page.getByRole("heading", { name: "The day I left home" }).first()).toBeVisible();
  await page.getByTestId("view-timeline").click();
  await expect(page.getByText("Left home by train at age seventeen")).toBeVisible();
  await page.getByTestId("view-tree").click();
  await expect(page.getByRole("button", { name: /Ming.*younger brother/i }).last()).toBeVisible();
  await page.getByTestId("generate-prompt").click();
  const exactPrompt = "Ask Grandma what happened to her younger brother Ming after she left home.";
  await expect(page.getByText(exactPrompt)).toBeVisible();
  await page.getByTestId("start-gathering").click();
  await expect(page.getByText("Recording is off")).toBeVisible();
  await expect(page.getByText("Linger is quiet. The question now belongs to the family.")).toBeVisible({ timeout: 16_000 });
});

test("moves focus to each wizard phase and honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Start the conversation" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toContainText("Conversation step");
  const duration = await page.locator(".waveform span").first().evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.1);
});

test("runs the full voice conversation on the root radio", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("switch", { name: "Switch voice session on" }).click();
  await expect(page.locator("#recording-consent")).toBeFocused();
  await page.locator('label[for="recording-consent"]').click();
  await page.getByRole("switch", { name: "Switch voice session on" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Take all the time you need." })).toBeVisible();
  await page.getByRole("button", { name: "Show live transcript" }).click();
  await expect(page.getByRole("heading", { name: "Conversation transcript" })).toBeVisible();
});

test("redirects the legacy conversation route to root", async ({ page }) => {
  await page.goto("/conversation");
  await expect(page).toHaveURL(/\/$/);
});
