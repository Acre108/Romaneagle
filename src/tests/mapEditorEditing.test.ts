import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBlankBattlefieldMap,
  mapTileAt,
  serializeBattlefieldMap,
} from "../gridBattle/model/battlefieldMap";
import { MapEditHistory } from "../mapEditor/MapEditHistory";
import { applyMapEditorTool, eraseMapEditorLayer, tilesAlongLine, type MapEditorTool } from "../mapEditor/MapEditor";
import { savedMapsStatus } from "../mapEditor/MapStorage";
import { readProjectMaps } from "../mapEditor/localMapServer";

describe("map edit history", () => {
  const paint = (map: ReturnType<typeof createBlankBattlefieldMap>, x: number) => {
    applyMapEditorTool(map, { x, y: 0 }, { kind: "terrain", terrain: "road" });
  };

  it("undoes and redoes an edit", () => {
    const history = new MapEditHistory();
    let map = createBlankBattlefieldMap(4, 4);
    const before = serializeBattlefieldMap(map);
    paint(map, 1);
    history.record(before);
    const painted = serializeBattlefieldMap(map);

    map = history.undo(map)!;
    expect(serializeBattlefieldMap(map)).toEqual(before);
    expect(history.canRedo).toBe(true);

    map = history.redo(map)!;
    expect(serializeBattlefieldMap(map)).toEqual(painted);
    expect(history.canUndo).toBe(true);
  });

  it("forgets redo once a new edit is made", () => {
    const history = new MapEditHistory();
    let map = createBlankBattlefieldMap(4, 4);
    history.record(serializeBattlefieldMap(map));
    paint(map, 1);
    map = history.undo(map)!;
    history.record(serializeBattlefieldMap(map));
    paint(map, 2);
    expect(history.canRedo).toBe(false);
    expect(history.redo(map)).toBeNull();
  });

  it("returns nothing when there is nothing to undo", () => {
    expect(new MapEditHistory().undo(createBlankBattlefieldMap(4, 4))).toBeNull();
  });

  it("keeps only the most recent edits", () => {
    const history = new MapEditHistory(2);
    let map = createBlankBattlefieldMap(4, 4);
    for (const x of [0, 1, 2]) {
      history.record(serializeBattlefieldMap(map));
      paint(map, x);
    }
    map = history.undo(map)!;
    map = history.undo(map)!;
    expect(history.canUndo).toBe(false);
    expect(mapTileAt(map, { x: 0, y: 0 })?.terrain).toBe("road");
    expect(mapTileAt(map, { x: 1, y: 0 })?.terrain).toBe("clear");
  });

  it("restores a map that can still be edited", () => {
    const history = new MapEditHistory();
    let map = createBlankBattlefieldMap(4, 4);
    history.record(serializeBattlefieldMap(map));
    applyMapEditorTool(map, { x: 0, y: 0 }, { kind: "building", width: 2, depth: 2 });
    map = history.undo(map)!;
    expect(map.buildings).toEqual([]);
    applyMapEditorTool(map, { x: 0, y: 0 }, { kind: "building", width: 2, depth: 2 });
    expect(map.buildings).toHaveLength(1);
  });
});

describe("drag lines", () => {
  it("returns a single tile when the pointer has not moved", () => {
    expect(tilesAlongLine({ x: 2, y: 3 }, { x: 2, y: 3 })).toEqual([{ x: 2, y: 3 }]);
  });

  it("covers every tile on a straight drag in either direction", () => {
    expect(tilesAlongLine({ x: 1, y: 5 }, { x: 4, y: 5 }).map((tile) => tile.x)).toEqual([1, 2, 3, 4]);
    expect(tilesAlongLine({ x: 3, y: 4 }, { x: 3, y: 1 }).map((tile) => tile.y)).toEqual([4, 3, 2, 1]);
  });

  it("keeps diagonal drags connected through tile sides", () => {
    for (const [from, to] of [
      [{ x: 0, y: 0 }, { x: 7, y: 3 }],
      [{ x: 9, y: 9 }, { x: 2, y: 4 }],
      [{ x: 0, y: 6 }, { x: 6, y: 0 }],
    ] as const) {
      const tiles = tilesAlongLine(from, to);
      expect(tiles[0]).toEqual(from);
      expect(tiles.at(-1)).toEqual(to);
      for (let index = 1; index < tiles.length; index += 1) {
        const step = Math.abs(tiles[index]!.x - tiles[index - 1]!.x) + Math.abs(tiles[index]!.y - tiles[index - 1]!.y);
        expect(step).toBe(1);
      }
    }
  });
});

describe("right-click erasing", () => {
  const position = { x: 1, y: 1 };

  it("resets terrain and leaves objects alone with a terrain tool", () => {
    const map = createBlankBattlefieldMap(4, 4);
    applyMapEditorTool(map, position, { kind: "ground-texture", terrain: "rough", texture: "heather_moor" });
    applyMapEditorTool(map, position, { kind: "object", object: "tree_small" });

    const tool: MapEditorTool = { kind: "ground-texture", terrain: "rough", texture: "heather_moor" };
    expect(eraseMapEditorLayer(map, position, tool, null)).toContain("clear ground");

    const tile = mapTileAt(map, position);
    expect(tile?.terrain).toBe("clear");
    expect(tile?.groundTexture).toBeUndefined();
    expect(tile?.objects).toEqual(["tree_small"]);
  });

  it("removes objects only with an object tool, and says when there are none", () => {
    const map = createBlankBattlefieldMap(4, 4);
    applyMapEditorTool(map, position, { kind: "object", object: "tree_small" });
    const tool: MapEditorTool = { kind: "object", object: "tree_small" };
    expect(eraseMapEditorLayer(map, position, tool, null)).toContain("Removed objects");
    expect(mapTileAt(map, position)?.objects).toBeUndefined();
    expect(eraseMapEditorLayer(map, position, tool, null)).toContain("No objects");
  });

  it("leaves a map unchanged when there is nothing to erase", () => {
    const map = createBlankBattlefieldMap(4, 4);
    for (const tool of [
      { kind: "erase-unit" }, { kind: "erase-spawn" }, { kind: "erase-building" }, { kind: "erase-objects" },
    ] as const) eraseMapEditorLayer(map, position, tool, null);
    expect(map.revision).toBe(0);
  });

  it("reports a refused edit as an error the editor can show", () => {
    const map = createBlankBattlefieldMap(4, 4);
    applyMapEditorTool(map, position, { kind: "building", width: 2, depth: 2 });
    expect(() => eraseMapEditorLayer(map, position, { kind: "elevation", elevation: 1 }, null)).toThrow("Remove the building");
  });
});

describe("listing saved maps", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "map-list-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reports files it cannot use instead of hiding them", async () => {
    await writeFile(join(directory, "good.json"), JSON.stringify(serializeBattlefieldMap(createBlankBattlefieldMap(4, 4))));
    await writeFile(join(directory, "broken.json"), "{ not json");
    await writeFile(join(directory, "old.json"), JSON.stringify({ schemaVersion: 1 }));
    await writeFile(join(directory, "Bad Name.json"), "{}");
    await writeFile(join(directory, "notes.txt"), "ignored");

    const { maps, unreadable } = await readProjectMaps(directory);

    expect(maps.map((map) => map.fileName)).toEqual(["good.json"]);
    expect(unreadable.map((file) => file.fileName)).toEqual(["Bad Name.json", "broken.json", "old.json"]);
    expect(unreadable.find((file) => file.fileName === "old.json")?.reason).toContain("schema version 1");
    expect(unreadable.find((file) => file.fileName === "Bad Name.json")?.reason).toContain("lowercase");
  });

  it("describes the folder for the player", () => {
    expect(savedMapsStatus([{}, {}], [])).toBe("2 saved maps available.");
    expect(savedMapsStatus([], [])).toContain("No saved maps yet");
    const withBad = savedMapsStatus([{}], [{ fileName: "old.json", reason: "Unsupported version" }]);
    expect(withBad).toContain("1 saved map available.");
    expect(withBad).toContain("old.json: Unsupported version");
  });
});
