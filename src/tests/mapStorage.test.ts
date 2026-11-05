import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankBattlefieldMap } from "../gridBattle/model/battlefieldMap";
import { ProjectMapConflictError, projectMapFileName, saveProjectMap } from "../mapEditor/MapStorage";
import { ProjectMapExistsError, isSafeProjectMapFileName, writeProjectMapFile } from "../mapEditor/localMapServer";

describe("project map storage", () => {
  it("creates stable safe filenames from editor map names", () => {
    expect(projectMapFileName("  Blackwater Ford!  ")).toBe("blackwater-ford.json");
    expect(projectMapFileName("***")).toBe("battlefield-map.json");
    expect(isSafeProjectMapFileName(projectMapFileName("Northern Road"))).toBe(true);
  });

  it("rejects traversal, nested paths, and unsupported filenames", () => {
    expect(isSafeProjectMapFileName("../campaign.json")).toBe(false);
    expect(isSafeProjectMapFileName("nested/map.json")).toBe(false);
    expect(isSafeProjectMapFileName("Uppercase.json")).toBe(false);
    expect(isSafeProjectMapFileName("map.txt")).toBe(false);
  });

  it("keeps generated filenames within the server limit", () => {
    const fileName = projectMapFileName("a".repeat(200));
    expect(fileName).toHaveLength(69);
    expect(isSafeProjectMapFileName(fileName)).toBe(true);
  });
});

describe("writing map files", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "map-storage-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("creates a new file and leaves no temporary files behind", async () => {
    await writeProjectMapFile(directory, "ford.json", "first", false);
    expect(await readFile(join(directory, "ford.json"), "utf8")).toBe("first");
    expect(await readdir(directory)).toEqual(["ford.json"]);
  });

  it("refuses to replace an existing file unless asked", async () => {
    await writeProjectMapFile(directory, "ford.json", "first", false);
    await expect(writeProjectMapFile(directory, "ford.json", "second", false)).rejects.toBeInstanceOf(ProjectMapExistsError);
    expect(await readFile(join(directory, "ford.json"), "utf8")).toBe("first");
  });

  it("replaces an existing file when asked", async () => {
    await writeFile(join(directory, "ford.json"), "first");
    await writeProjectMapFile(directory, "ford.json", "second", true);
    expect(await readFile(join(directory, "ford.json"), "utf8")).toBe("second");
    expect(await readdir(directory)).toEqual(["ford.json"]);
  });

  it("creates the maps folder when it is missing", async () => {
    await writeProjectMapFile(join(directory, "maps"), "ford.json", "first", false);
    expect(await readFile(join(directory, "maps", "ford.json"), "utf8")).toBe("first");
  });
});

describe("saving maps from the editor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubResponse(status: number, body: unknown) {
    const fetchStub = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchStub);
    return fetchStub;
  }

  it("does not ask to overwrite by default", async () => {
    const fetchStub = stubResponse(200, { fileName: "ford.json", path: "public/maps/ford.json" });
    await saveProjectMap("Ford", createBlankBattlefieldMap(4, 4));
    expect(fetchStub.mock.calls[0]![0]).toBe("/api/project-maps/ford.json");
  });

  it("asks to overwrite only when told to", async () => {
    const fetchStub = stubResponse(200, { fileName: "ford.json", path: "public/maps/ford.json" });
    await saveProjectMap("Ford", createBlankBattlefieldMap(4, 4), true);
    expect(fetchStub.mock.calls[0]![0]).toBe("/api/project-maps/ford.json?overwrite=true");
  });

  it("reports a name clash as a conflict rather than a failure", async () => {
    stubResponse(409, { error: "A saved map named ford.json already exists." });
    await expect(saveProjectMap("Ford", createBlankBattlefieldMap(4, 4))).rejects.toBeInstanceOf(ProjectMapConflictError);
  });

  it("still reports other failures as ordinary errors", async () => {
    stubResponse(400, { error: "Unsupported battlefield map." });
    const failure = saveProjectMap("Ford", createBlankBattlefieldMap(4, 4));
    await expect(failure).rejects.toThrow("Unsupported battlefield map.");
    await expect(failure).rejects.not.toBeInstanceOf(ProjectMapConflictError);
  });
});
