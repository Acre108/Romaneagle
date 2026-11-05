import { describe, expect, it } from "vitest";
import { projectMapFileName } from "../mapEditor/MapStorage";
import { isSafeProjectMapFileName } from "../mapEditor/localMapServer";

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
