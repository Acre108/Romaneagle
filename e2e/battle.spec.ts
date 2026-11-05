import { expect, test, type Page } from "@playwright/test";

const SAVE_KEY = "last-eagle-campaign-progress-v1";

async function text(page: Page, id: string): Promise<string> {
  return page.evaluate((elementId) => document.getElementById(elementId)?.textContent ?? "", id);
}

async function beginTestBattle(page: Page): Promise<void> {
  await page.click("#begin-test-scenario");
  await expect(page.locator("#battlefield")).toBeVisible();
  await expect(page.locator("#grid-active-faction")).toHaveText("Romans");
  await waitForBoard(page);
}

/** A frame proves the main thread is alive: the second-battle freeze never produced one. */
async function waitForBoard(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.waitForTimeout(1500);
}

async function selectRomanFormation(page: Page): Promise<string> {
  const box = await page.locator("#battlefield").boundingBox();
  if (!box) throw new Error("The battlefield has no size.");
  for (let y = 40; y < box.height - 20; y += 22) {
    for (let x = 40; x < box.width - 20; x += 30) {
      await page.mouse.click(box.x + x, box.y + y);
      const name = await text(page, "grid-formation-name");
      const inspecting = await text(page, "grid-formation-label") === "INSPECTING FORMATION";
      if (name && name !== "No formation selected" && !inspecting) return name;
    }
  }
  throw new Error("No Roman formation could be selected.");
}

async function passRomanActivationAndWait(page: Page): Promise<void> {
  await selectRomanFormation(page);
  await page.keyboard.press("Space");
  await expect(page.locator("#grid-active-faction")).toContainText("Computer");
  await expect(page.locator("#grid-active-faction")).toHaveText("Romans", { timeout: 45_000 });
}

test("consecutive battles start and keep playing", async ({ page }) => {
  await page.goto("/");
  await page.click("#open-test-scenario");
  for (let battle = 1; battle <= 2; battle += 1) {
    await beginTestBattle(page);
    await passRomanActivationAndWait(page);
    await page.click("#grid-conclude");
    await page.click("#return-from-battle");
    await expect(page.locator("#test-scenario-screen")).toBeVisible();
    await page.waitForTimeout(600);
  }
});

test("input during the computer's turn cannot stop it", async ({ page }) => {
  await page.goto("/");
  await page.click("[data-campaign]");
  await page.click("#begin-battle");
  await expect(page.locator("#battlefield")).toBeVisible();
  await waitForBoard(page);
  await selectRomanFormation(page);
  await page.keyboard.press("Space");

  const box = await page.locator("#battlefield").boundingBox();
  if (!box) throw new Error("The battlefield has no size.");
  await expect(async () => {
    await page.keyboard.press("Escape");
    await page.mouse.click(box.x + 300, box.y + 300, { button: "right" });
    await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-grid-facing]")?.click());
    expect(await text(page, "grid-active-faction")).toBe("Romans");
  }).toPass({ timeout: 45_000, intervals: [50] });
  await expect(page.locator("#grid-move-facing")).toBeHidden();
  await expect(page.locator("[data-grid-action='end']")).toBeVisible();
});

test("the campaign names the enemy it is fighting", async ({ page }) => {
  await page.goto("/");
  await page.click("[data-campaign]");
  await page.click("#begin-battle");
  await expect(page.locator("#battlefield")).toBeVisible();
  await waitForBoard(page);
  await selectRomanFormation(page);
  await page.keyboard.press("Space");
  await expect(page.locator("#grid-active-faction")).toHaveText("Picts · Computer");
});

test("reset asks first and does nothing once the battle is over", async ({ page }) => {
  await page.goto("/");
  await page.click("#open-test-scenario");
  await beginTestBattle(page);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  const name = await selectRomanFormation(page);
  await page.keyboard.press("Backspace");
  expect(dialogs).toHaveLength(1);
  await expect(page.locator("#grid-formation-name")).toHaveText(name);

  await page.click("#grid-conclude");
  await expect(page.locator("#battle-result")).toBeVisible();
  await page.keyboard.press("Backspace");
  expect(dialogs).toHaveLength(1);
  await expect(page.locator("#battle-result")).toBeVisible();
  await expect(page.locator("#grid-reset")).toBeDisabled();
});

test("clicking an enemy shows its card without changing the player's selection", async ({ page }) => {
  await page.goto("/");
  await page.click("#open-test-scenario");
  await beginTestBattle(page);
  await selectRomanFormation(page);
  const box = await page.locator("#battlefield").boundingBox();
  if (!box) throw new Error("The battlefield has no size.");
  let inspected = false;
  for (let y = 40; y < box.height - 20 && !inspected; y += 22) {
    for (let x = 40; x < box.width - 20 && !inspected; x += 30) {
      await page.mouse.click(box.x + x, box.y + y);
      inspected = await text(page, "grid-formation-label") === "INSPECTING FORMATION";
    }
  }
  expect(inspected).toBe(true);
  const stats = () => text(page, "grid-formation-stats");
  expect(await stats()).not.toContain("Romans");
  expect(await stats()).toContain("Morale");
  await expect(page.locator("[data-grid-action='end']")).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.locator("#grid-formation-label")).toHaveText("SELECTED FORMATION");
  expect(await stats()).toContain("Romans");
});

test("the debrief preview does not complete a mission", async ({ page }) => {
  await page.goto("/?debrief");
  await expect(page.locator("#victory-debrief")).toBeVisible();
  const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(JSON.parse(saved ?? "{}").completedMissions ?? []).toEqual([]);
});

test("the sandbox fields the formations chosen for it", async ({ page }) => {
  await page.goto("/");
  await page.click("#open-test-scenario");
  await page.click("[data-test-unit-id].selected");
  const cards = await page.locator("[data-test-unit-id].selected").allTextContents();
  expect(cards.length).toBeGreaterThan(0);
  await beginTestBattle(page);
  const selected = await selectRomanFormation(page);
  expect(cards.some((card) => card.includes(selected))).toBe(true);
});
