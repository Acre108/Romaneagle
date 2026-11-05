import { Graphics } from "pixi.js";
import { edgeFeaturePhysicalKey, type EdgeFeaturePlacement } from "../model/battlefieldMap";
import type { edgeFeatureDefinition } from "../model/edgeFeatureDefinitions";
import type { GroundTextureId, TerrainObjectType } from "../model/terrainDefinitions";
import type { ScreenPosition } from "./isometric/IsoProjection";

export function interpolatePoint(start: ScreenPosition, end: ScreenPosition, ratio: number): ScreenPosition {
  return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
}

export function drawGroundTextureDetails(
  graphics: Graphics,
  centre: ScreenPosition,
  texture: GroundTextureId,
  detailColour: number,
): void {
  switch (texture) {
    case "grass":
      graphics.moveTo(centre.x - 12, centre.y + 4).lineTo(centre.x - 5, centre.y)
        .moveTo(centre.x + 8, centre.y + 6).lineTo(centre.x + 14, centre.y + 3)
        .stroke({ width: 1, color: detailColour, alpha: 0.55 });
      return;
    case "pasture":
      graphics.circle(centre.x - 13, centre.y + 2, 1.5).fill({ color: detailColour, alpha: 0.5 })
        .circle(centre.x + 9, centre.y - 3, 1.2).fill({ color: detailColour, alpha: 0.45 })
        .moveTo(centre.x - 2, centre.y + 7).lineTo(centre.x + 2, centre.y + 4)
        .stroke({ width: 1, color: detailColour, alpha: 0.5 });
      return;
    case "dry_grass":
      graphics.moveTo(centre.x - 13, centre.y + 6).lineTo(centre.x - 13, centre.y - 1)
        .moveTo(centre.x - 13, centre.y + 2).lineTo(centre.x - 17, centre.y)
        .moveTo(centre.x + 11, centre.y + 5).lineTo(centre.x + 13, centre.y - 2)
        .stroke({ width: 1.2, color: detailColour, alpha: 0.72 });
      return;
    case "upland_grass":
      graphics.moveTo(centre.x - 18, centre.y + 5).lineTo(centre.x - 8, centre.y)
        .moveTo(centre.x - 3, centre.y + 7).lineTo(centre.x + 8, centre.y + 1)
        .moveTo(centre.x + 9, centre.y + 4).lineTo(centre.x + 18, centre.y)
        .stroke({ width: 1.4, color: detailColour, alpha: 0.62 });
      return;
    case "rough_ground":
      graphics.ellipse(centre.x - 13, centre.y + 2, 6, 3).fill({ color: detailColour, alpha: 0.58 })
        .ellipse(centre.x + 10, centre.y - 3, 5, 2.5).fill({ color: detailColour, alpha: 0.52 })
        .moveTo(centre.x - 2, centre.y + 8).lineTo(centre.x + 8, centre.y + 3)
        .stroke({ width: 2, color: detailColour, alpha: 0.7 });
      return;
    case "heather_moor":
      graphics.circle(centre.x - 14, centre.y + 2, 3).fill({ color: detailColour, alpha: 0.66 })
        .circle(centre.x - 6, centre.y - 2, 2).fill({ color: detailColour, alpha: 0.55 })
        .circle(centre.x + 11, centre.y + 4, 3.5).fill({ color: detailColour, alpha: 0.62 });
      return;
    case "ploughed_field":
      for (const offset of [-8, 0, 8]) {
        graphics.moveTo(centre.x - 24 + offset, centre.y + 7)
          .lineTo(centre.x + 18 + offset, centre.y - 6)
          .stroke({ width: 1.5, color: detailColour, alpha: 0.58 });
      }
      return;
    case "scree":
      graphics.poly([centre.x - 17, centre.y + 5, centre.x - 12, centre.y - 3, centre.x - 7, centre.y + 4], true)
        .fill({ color: detailColour, alpha: 0.72 })
        .poly([centre.x + 4, centre.y + 4, centre.x + 10, centre.y - 5, centre.x + 16, centre.y + 5], true)
        .fill({ color: detailColour, alpha: 0.62 });
      return;
    case "shingle":
      for (const [x, y, radius] of [[-16, 3, 2], [-8, -2, 1.5], [1, 4, 2], [10, -3, 1.5], [17, 3, 2]] as const) {
        graphics.ellipse(centre.x + x, centre.y + y, radius * 1.5, radius)
          .fill({ color: detailColour, alpha: 0.62 });
      }
      return;
    case "swamp":
      graphics.ellipse(centre.x - 10, centre.y + 2, 8, 3).fill({ color: 0x263b3d, alpha: 0.72 })
        .ellipse(centre.x + 12, centre.y - 2, 6, 2.5).fill({ color: 0x263b3d, alpha: 0.62 })
        .moveTo(centre.x, centre.y + 6).lineTo(centre.x - 2, centre.y - 2)
        .moveTo(centre.x + 3, centre.y + 6).lineTo(centre.x + 5, centre.y - 1)
        .stroke({ width: 1.2, color: detailColour, alpha: 0.76 });
      return;
    case "peat_bog":
      graphics.ellipse(centre.x - 11, centre.y + 1, 9, 4).fill({ color: 0x252c29, alpha: 0.72 })
        .ellipse(centre.x + 12, centre.y + 2, 7, 3).fill({ color: 0x2d3230, alpha: 0.62 })
        .circle(centre.x, centre.y - 4, 2).fill({ color: detailColour, alpha: 0.58 });
      return;
    case "saltmarsh":
      graphics.moveTo(centre.x - 22, centre.y + 3).quadraticCurveTo(centre.x - 8, centre.y - 5, centre.x + 2, centre.y + 1)
        .quadraticCurveTo(centre.x + 12, centre.y + 7, centre.x + 22, centre.y - 1)
        .stroke({ width: 2.5, color: 0x66868a, alpha: 0.68 })
        .moveTo(centre.x - 10, centre.y + 6).lineTo(centre.x - 12, centre.y)
        .moveTo(centre.x + 13, centre.y + 5).lineTo(centre.x + 15, centre.y - 1)
        .stroke({ width: 1, color: detailColour, alpha: 0.7 });
      return;
    case "mudflat":
      graphics.ellipse(centre.x + 10, centre.y - 1, 7, 3).fill({ color: 0x3d4948, alpha: 0.58 })
        .moveTo(centre.x - 18, centre.y + 2).lineTo(centre.x - 8, centre.y - 1)
        .lineTo(centre.x - 3, centre.y + 5)
        .moveTo(centre.x - 8, centre.y - 1).lineTo(centre.x - 5, centre.y - 6)
        .stroke({ width: 1.2, color: detailColour, alpha: 0.64 });
      return;
  }
  const unhandledTexture: never = texture;
  return unhandledTexture;
}

export function drawTerrainObject(
  graphics: Graphics,
  object: TerrainObjectType,
  centreX: number,
  baseY: number,
): void {
  switch (object) {
    case "tree_small":
      graphics.rect(centreX - 2, baseY - 14, 4, 14).fill(0x5c422b)
        .circle(centreX, baseY - 18, 8).fill(0x4f6a39)
        .circle(centreX - 4, baseY - 15, 5).fill(0x405c31);
      return;
    case "tree_large":
      graphics.rect(centreX - 3, baseY - 21, 6, 21).fill(0x513824)
        .circle(centreX, baseY - 27, 13).fill(0x38542d)
        .circle(centreX - 9, baseY - 22, 9).fill(0x456535)
        .circle(centreX + 9, baseY - 22, 9).fill(0x456535);
      return;
    case "rock_small":
      graphics.ellipse(centreX, baseY + 1, 7, 3).fill({ color: 0x1c211f, alpha: 0.35 })
        .poly([
          centreX - 6, baseY,
          centreX - 3, baseY - 6,
          centreX + 2, baseY - 8,
          centreX + 6, baseY - 2,
        ], true).fill(0x646960).stroke({ width: 1, color: 0x343a36 });
      return;
    case "rock_large":
      graphics.ellipse(centreX, baseY + 2, 14, 5).fill({ color: 0x1c211f, alpha: 0.4 })
        .poly([
          centreX - 12, baseY,
          centreX - 8, baseY - 12,
          centreX, baseY - 17,
          centreX + 11, baseY - 5,
          centreX + 13, baseY,
        ], true).fill(0x555b55).stroke({ width: 1.5, color: 0x303632 })
        .poly([
          centreX - 8, baseY - 11,
          centreX, baseY - 17,
          centreX + 3, baseY - 7,
        ], true).fill({ color: 0x858a80, alpha: 0.65 });
      return;
    case "pond":
      graphics.ellipse(centreX, baseY, 15, 7)
        .fill({ color: 0x315a5d, alpha: 0.92 })
        .stroke({ width: 1.5, color: 0x719d8e, alpha: 0.9 })
        .moveTo(centreX - 9, baseY - 1).quadraticCurveTo(centreX - 4, baseY - 4, centreX + 1, baseY - 1)
        .moveTo(centreX + 3, baseY + 2).quadraticCurveTo(centreX + 7, baseY, centreX + 10, baseY + 2)
        .stroke({ width: 1, color: 0xa4c5b9, alpha: 0.75 });
      return;
  }
  const unhandledObject: never = object;
  return unhandledObject;
}

export function drawEdgeFeatureShape(
  feature: EdgeFeaturePlacement,
  definition: ReturnType<typeof edgeFeatureDefinition>,
  baseStart: ScreenPosition,
  baseEnd: ScreenPosition,
): Graphics {
  const height = definition.height === "tall" ? 26 : 9;
  const topStart = { x: baseStart.x, y: baseStart.y - height };
  const topEnd = { x: baseEnd.x, y: baseEnd.y - height };
  const graphic = new Graphics({ label: `terrain-ledge-edge-${edgeFeaturePhysicalKey(feature.position, feature.direction)}` });
  graphic.poly([
    baseStart.x, baseStart.y, baseEnd.x, baseEnd.y,
    topEnd.x, topEnd.y, topStart.x, topStart.y,
  ], true).fill({ color: definition.wallColour, alpha: definition.height === "tall" ? 0.96 : 0.8 })
    .stroke({ width: 1.5, color: definition.topColour, alpha: 0.9 });

  if (definition.appearance === "hedge") {
    for (let index = 0; index <= 8; index += 1) {
      const ratio = index / 8;
      const top = interpolatePoint(topStart, topEnd, ratio);
      const radius = definition.height === "tall" ? 6.5 : 4.5;
      graphic.circle(top.x, top.y + (index % 2 === 0 ? 1.5 : -1.5), radius)
        .fill({ color: definition.topColour, alpha: .96 });
    }
    for (const ratio of [.15, .38, .62, .85]) {
      const base = interpolatePoint(baseStart, baseEnd, ratio);
      const top = { x: base.x, y: base.y - height };
      graphic.moveTo(base.x, base.y).lineTo(top.x, top.y)
        .stroke({ width: 1.5, color: definition.topColour, alpha: .62 });
    }
    return graphic;
  }

  const uprightRatios = definition.appearance === "door" ? [0, .25, .5, .75, 1]
    : definition.appearance === "stone_wall" ? [0, .2, .4, .6, .8, 1]
      : [0, .5, 1];
  for (const ratio of uprightRatios) {
    const base = interpolatePoint(baseStart, baseEnd, ratio);
    const top = { x: base.x, y: base.y - height };
    graphic.moveTo(base.x, base.y).lineTo(top.x, top.y)
      .stroke({ width: definition.height === "tall" ? 2.2 : 1.5, color: definition.topColour, alpha: 0.82 });
  }
  if (definition.appearance === "stone_wall") {
    graphic.moveTo(baseStart.x, baseStart.y - height * .46)
      .lineTo(baseEnd.x, baseEnd.y - height * .46)
      .stroke({ width: 1.4, color: definition.topColour, alpha: .52 });
  } else if (definition.appearance === "door") {
    const braceStart = interpolatePoint(baseStart, baseEnd, .12);
    const braceEnd = interpolatePoint(baseStart, baseEnd, .88);
    graphic.moveTo(braceStart.x, braceStart.y - height * .22)
      .lineTo(braceEnd.x, braceEnd.y - height * .78)
      .stroke({ width: 3, color: definition.topColour, alpha: .82 });
    const handle = interpolatePoint(baseStart, baseEnd, .7);
    graphic.circle(handle.x, handle.y - height * .52, 2.2).fill(0xe0bd72);
  }
  if (definition.enclosure === "enclosed") {
    const dx = topEnd.x - topStart.x;
    const dy = topEnd.y - topStart.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const roofX = -dy / length * 5;
    const roofY = dx / length * 5;
    graphic.poly([
      topStart.x - roofX, topStart.y - roofY,
      topEnd.x - roofX, topEnd.y - roofY,
      topEnd.x + roofX, topEnd.y + roofY,
      topStart.x + roofX, topStart.y + roofY,
    ], true).fill(definition.roofColour ?? definition.topColour)
      .stroke({ width: 1.5, color: definition.topColour, alpha: 0.95 });
  } else {
    graphic.moveTo(topStart.x, topStart.y).lineTo(topEnd.x, topEnd.y)
      .stroke({ width: 3, color: definition.topColour, alpha: 0.95 });
  }
  return graphic;
}
