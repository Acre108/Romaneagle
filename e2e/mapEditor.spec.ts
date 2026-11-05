import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const FILE_NAME = "e2e-map-save-test";
const FILE_PATH = `public/maps/${FILE_NAME}.json`;
const BROKEN_FILE_PATH = "public/maps/e2e-broken-map-test.json";

function removeTestMap(): void {
  rmSync(FILE_PATH, { force: true });
  rmSync(BROKEN_FILE_PATH, { force: true });
}

async function openEditor(page: Page): Promise<void> {
  await page.goto("/");
  await page.click("#open-map-editor");
  await expect(page.locator("#map-editor-canvas")).toBeVisible();
}

async function paintTile(page: Page): Promise<void> {
  const box = await page.locator("#map-editor-canvas").boundingBox();
  if (!box) throw new Error("The editor canvas has no size.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function chooseObjectTool(page: Page): Promise<void> {
  await page.locator("#map-editor-object-tools button").first().click();
}

test.beforeEach(removeTestMap);
test.afterEach(removeTestMap);

test("saving tracks changes and only asks before replacing another map", async ({ page }) => {
  const dialogs: string[] = [];
  let accept = false;
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  await openEditor(page);
  await expect(page.locator("#map-editor-save-state")).toHaveText("Blank map");

  await page.fill("#map-editor-name", FILE_NAME);
  await chooseObjectTool(page);
  await paintTile(page);
  await expect(page.locator("#map-editor-save-state")).toHaveText("Unsaved changes");

  // A new name saves without asking.
  await page.click("#map-editor-save-project");
  await expect(page.locator("#map-editor-save-state")).toHaveText("Saved");
  expect(dialogs).toEqual([]);
  const first = readFileSync(FILE_PATH, "utf8");

  // Saving over its own file does not ask either.
  await paintTile(page);
  await page.click("#map-editor-save-project");
  await expect(page.locator("#map-editor-save-state")).toHaveText("Saved");
  expect(dialogs).toEqual([]);
  const second = readFileSync(FILE_PATH, "utf8");
  expect(second).not.toBe(first);

  // Replacing unsaved edits with a blank map asks, and declining keeps them.
  await paintTile(page);
  await page.click("#map-editor-size-form button[type=submit]");
  expect(dialogs).toHaveLength(1);
  await expect(page.locator("#map-editor-save-state")).toHaveText("Unsaved changes");
  accept = true;
  await page.click("#map-editor-size-form button[type=submit]");
  expect(dialogs).toHaveLength(2);
  await expect(page.locator("#map-editor-save-state")).toHaveText("Blank map");

  // A different map under an existing name asks, and declining leaves the file alone.
  accept = false;
  await page.click("#map-editor-save-project");
  await expect(page.locator("#map-editor-status")).toContainText("Not saved");
  expect(dialogs).toHaveLength(3);
  expect(dialogs[2]).toContain("already exists");
  expect(readFileSync(FILE_PATH, "utf8")).toBe(second);

  // Accepting replaces it.
  accept = true;
  await page.click("#map-editor-save-project");
  await expect(page.locator("#map-editor-save-state")).toHaveText("Saved");
  expect(dialogs).toHaveLength(4);
  expect(readFileSync(FILE_PATH, "utf8")).not.toBe(second);
  expect(existsSync(FILE_PATH)).toBe(true);
});

test("opening a saved map asks before discarding edits, then saves back to it silently", async ({ page }) => {
  const dialogs: string[] = [];
  let accept = true;
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  await openEditor(page);
  await page.fill("#map-editor-name", FILE_NAME);
  await chooseObjectTool(page);
  await paintTile(page);
  await page.click("#map-editor-save-project");
  await expect(page.locator("#map-editor-save-state")).toHaveText("Saved");

  await paintTile(page);
  await page.click("#leave-map-editor");
  await page.click("#open-saved-maps");
  const card = page.locator(`[data-map-file="${FILE_NAME}.json"]`);
  const edit = card.locator("[data-map-action]:not([data-map-action='battle'])");

  accept = false;
  await edit.click();
  expect(dialogs).toHaveLength(1);
  await expect(page.locator("#map-editor-screen")).toBeHidden();

  accept = true;
  await edit.click();
  expect(dialogs).toHaveLength(2);
  await expect(page.locator("#map-editor-save-state")).toHaveText("Saved");

  // The display name differs from the filename, but it is still this map's own file.
  await paintTile(page);
  await page.click("#map-editor-save-project");
  await expect(page.locator("#map-editor-save-state")).toHaveText("Saved");
  expect(dialogs).toHaveLength(2);
});

/** The tile's centre on screen, from the same sizing rule the editor draws with (16 × 12 blank map). */
async function tileCentre(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator("#map-editor-canvas").boundingBox();
  if (!box) throw new Error("The editor canvas has no size.");
  const padding = 34;
  const cellSize = Math.max(6, Math.min(54, Math.floor((box.width - padding * 2) / 16), Math.floor((box.height - padding * 2) / 12)));
  const originX = Math.round((box.width - cellSize * 16) / 2);
  const originY = Math.round((box.height - cellSize * 12) / 2);
  return { x: box.x + originX + (x + 0.5) * cellSize, y: box.y + originY + (y + 0.5) * cellSize };
}

async function savedTiles(page: Page): Promise<{ objects?: string[]; terrain: string }[]> {
  await page.fill("#map-editor-name", FILE_NAME);
  await page.click("#map-editor-save-project");
  await expect(page.locator("#map-editor-save-state")).toHaveText("Saved");
  return (JSON.parse(readFileSync(FILE_PATH, "utf8")) as { tiles: { objects?: string[]; terrain: string }[] }).tiles;
}

test("a fast drag paints every tile it crosses as one undoable stroke", async ({ page }) => {
  await openEditor(page);
  await chooseObjectTool(page);
  const start = await tileCentre(page, 1, 5);
  const end = await tileCentre(page, 14, 5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 2 });
  await page.mouse.up();
  await expect(page.locator("#map-editor-undo")).toBeEnabled();

  const row = (await savedTiles(page)).slice(5 * 16 + 1, 5 * 16 + 15);
  expect(row.filter((tile) => (tile.objects?.length ?? 0) > 0)).toHaveLength(14);

  await page.locator("#map-editor-canvas").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator("#map-editor-undo")).toBeDisabled();
  await expect(page.locator("#map-editor-save-state")).toHaveText("Unsaved changes");

  await page.keyboard.press("Control+y");
  await expect(page.locator("#map-editor-save-state")).toHaveText("Saved");
  await expect(page.locator("#map-editor-redo")).toBeDisabled();
});

test("undoing back to the saved map reads as saved, and the buttons work", async ({ page }) => {
  await openEditor(page);
  await chooseObjectTool(page);
  await expect(page.locator("#map-editor-undo")).toBeDisabled();
  await paintTile(page);
  await page.click("#map-editor-undo");
  await expect(page.locator("#map-editor-save-state")).toHaveText("Blank map");
  await page.click("#map-editor-redo");
  await expect(page.locator("#map-editor-save-state")).toHaveText("Unsaved changes");
});

test("a refused right-click shows why instead of raising an error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openEditor(page);
  await page.locator("#map-editor-building-tools button").first().click();
  const tile = await tileCentre(page, 5, 5);
  await page.mouse.click(tile.x, tile.y);
  await page.locator("#map-editor-elevation-tools button").nth(1).click();
  await page.mouse.click(tile.x, tile.y, { button: "right" });
  await expect(page.locator("#map-editor-status")).toContainText("Remove the building");
  expect(errors).toEqual([]);
});

test("the saved maps screen names a file it cannot read", async ({ page }) => {
  writeFileSync(BROKEN_FILE_PATH, "{ not json");
  await page.goto("/");
  await page.click("#open-saved-maps");
  await expect(page.locator("#saved-map-browser-status")).toContainText("e2e-broken-map-test.json");
  expect(existsSync(BROKEN_FILE_PATH)).toBe(true);
});
