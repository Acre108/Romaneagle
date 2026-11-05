import { describe, expect, it } from "vitest";
import { portraitAssetPath } from "../ui/Portraits";
import { ROMAN_FORMATIONS } from "../scenario/Roster";

describe("character portrait asset paths", () => {
  it("maps a companion ID to the public portraits folder", () => {
    expect(portraitAssetPath("flavia")).toBe("/portraits/flavia.png");
    expect(portraitAssetPath("brennos", "/game/")).toBe("/game/portraits/brennos.png");
  });

  it("encodes IDs before using them as filenames", () => {
    expect(portraitAssetPath("future commander", "/game"))
      .toBe("/game/portraits/future%20commander.png");
  });

  it("gives every Roman campaign commander a stable portrait path", () => {
    expect(ROMAN_FORMATIONS.map((formation) => portraitAssetPath(formation.companion.id))).toEqual([
      "/portraits/flavia.png",
      "/portraits/cassian.png",
      "/portraits/decimus.png",
      "/portraits/valeria.png",
      "/portraits/brennos.png",
      "/portraits/aelia.png",
    ]);
  });
});
