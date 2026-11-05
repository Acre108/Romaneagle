import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const FILE_NAME = "e2e-map-save-test";
const FILE_PATH = `public/maps/${FILE_NAME}.json`;

function removeTestMap(): void {
  rmSync(FILE_PATH, { force: true });
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
