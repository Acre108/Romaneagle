import { type BattlefieldMap, type EdgeFeaturePlacement, type GroundTerrainType, type GroundTextureId, type MapFormationDeployment, type MapSpawnPoint, type TerrainObjectType } from "../gridBattle/model/battlefieldMap";
import { groundTextureDefinition } from "../gridBattle/model/terrainDefinitions";
import { edgeFeatureDefinition } from "../gridBattle/model/edgeFeatureDefinitions";
import type { BuildingCell, Direction, GridPosition } from "../gridBattle/model/types";

export interface CanvasLayout {
  cellSize: number;
  originX: number;
  originY: number;
}

export function cssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

export function drawTerrainDetail(
  context: CanvasRenderingContext2D,
  terrain: GroundTerrainType,
  groundTexture: GroundTextureId | undefined,
  x: number,
  y: number,
  size: number,
  seed: number,
): void {
  if (size < 12) return;
  context.save();
  context.beginPath();
  context.rect(x, y, size, size);
  context.clip();
  if (groundTexture) {
    drawGroundTextureDetail(context, groundTexture, x, y, size, seed);
  } else if (terrain === "road") {
    context.fillStyle = "rgba(219, 197, 139, .18)";
    context.fillRect(x, y + size * .32, size, size * .36);
  } else if (terrain === "river_shallow" || terrain === "river_deep") {
    context.strokeStyle = terrain === "river_deep" ? "rgba(148, 211, 225, .38)" : "rgba(171, 225, 221, .3)";
    context.lineWidth = Math.max(1, size * .05);
    for (let offset = -size; offset < size * 2; offset += Math.max(6, size * .35)) {
      context.beginPath();
      context.moveTo(x + offset, y + size * .68);
      context.lineTo(x + offset + size * .5, y + size * .32);
      context.stroke();
    }
  } else if (terrain === "forest") {
    context.fillStyle = "rgba(13, 31, 14, .34)";
    for (let index = 0; index < 3; index += 1) {
      const px = x + size * (.22 + ((seed + index * 3) % 5) * .14);
      const py = y + size * (.25 + ((seed * 2 + index) % 4) * .17);
      context.beginPath();
      context.arc(px, py, Math.max(1.5, size * .08), 0, Math.PI * 2);
      context.fill();
    }
  } else if (terrain === "rough" || terrain === "dangerous") {
    context.strokeStyle = terrain === "dangerous" ? "rgba(176, 188, 151, .25)" : "rgba(224, 199, 136, .22)";
    context.lineWidth = 1;
    for (let index = 0; index < 3; index += 1) {
      const px = x + size * (.18 + index * .28);
      context.beginPath();
      context.moveTo(px, y + size * .72);
      context.lineTo(px + size * .1, y + size * .42);
      context.stroke();
    }
  } else if (terrain === "impassable" || terrain === "fortress_wall") {
    context.strokeStyle = terrain === "fortress_wall" ? "rgba(235, 225, 198, .32)" : "rgba(210, 213, 200, .2)";
    context.lineWidth = 1;
    const spacing = Math.max(5, size * .28);
    for (let offset = -size; offset < size * 2; offset += spacing) {
      context.beginPath();
      context.moveTo(x + offset, y + size);
      context.lineTo(x + offset + size, y);
      context.stroke();
    }
  }
  context.restore();
}

function drawGroundTextureDetail(
  context: CanvasRenderingContext2D,
  texture: GroundTextureId,
  x: number,
  y: number,
  size: number,
  seed: number,
): void {
  const detail = cssColour(groundTextureDefinition(texture).detailColour);
  context.fillStyle = detail;
  context.strokeStyle = detail;
  context.lineWidth = Math.max(1, size * .035);
  const point = (index: number) => ({
    x: x + size * (.18 + ((seed * 3 + index * 5) % 7) * .1),
    y: y + size * (.2 + ((seed + index * 3) % 6) * .12),
  });
  if (texture === "grass" || texture === "dry_grass" || texture === "upland_grass") {
    const stalks = texture === "upland_grass" ? 4 : 3;
    for (let index = 0; index < stalks; index += 1) {
      const p = point(index);
      const height = size * (texture === "dry_grass" ? .18 : .12);
      context.beginPath();
      context.moveTo(p.x, p.y + height);
      context.lineTo(p.x + (texture === "upland_grass" ? size * .12 : size * .04), p.y);
      context.stroke();
    }
    return;
  }
  if (texture === "pasture" || texture === "heather_moor" || texture === "shingle") {
    for (let index = 0; index < 5; index += 1) {
      const p = point(index);
      const radius = Math.max(1, size * (texture === "heather_moor" ? .07 : .035));
      context.beginPath();
      if (texture === "shingle") context.ellipse(p.x, p.y, radius * 1.6, radius, 0, 0, Math.PI * 2);
      else context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.fill();
    }
    return;
  }
  if (texture === "ploughed_field" || texture === "saltmarsh") {
    for (let index = -1; index < 4; index += 1) {
      context.beginPath();
      if (texture === "ploughed_field") {
        context.moveTo(x + index * size * .28, y + size);
        context.lineTo(x + (index + 2) * size * .28, y);
      } else {
        const lineY = y + size * (.22 + index * .2);
        context.moveTo(x, lineY);
        context.quadraticCurveTo(x + size * .5, lineY + size * .12, x + size, lineY);
      }
      context.stroke();
    }
    return;
  }
  if (texture === "rough_ground" || texture === "scree") {
    for (let index = 0; index < 4; index += 1) {
      const p = point(index);
      const radius = size * (texture === "scree" ? .08 : .055);
      context.beginPath();
      context.moveTo(p.x - radius, p.y + radius);
      context.lineTo(p.x, p.y - radius);
      context.lineTo(p.x + radius, p.y + radius);
      context.closePath();
      context.fill();
    }
    return;
  }
  if (texture === "swamp") {
    context.globalAlpha = .72;
    for (let index = 0; index < 3; index += 1) {
      const p = point(index);
      context.beginPath();
      context.ellipse(p.x, p.y, size * .11, size * .045, 0, 0, Math.PI * 2);
      context.fill();
    }
    return;
  }
  if (texture === "peat_bog") {
    for (let index = 0; index < 4; index += 1) {
      const p = point(index);
      context.fillRect(p.x - size * .055, p.y - size * .035, size * .11, size * .07);
    }
    return;
  }
  for (let index = 0; index < 4; index += 1) {
    const p = point(index);
    context.beginPath();
    context.moveTo(p.x - size * .08, p.y - size * .03);
    context.lineTo(p.x, p.y + size * .04);
    context.lineTo(p.x + size * .07, p.y - size * .06);
    context.stroke();
  }
}

export function drawElevationTint(
  context: CanvasRenderingContext2D,
  elevation: number,
  x: number,
  y: number,
  size: number,
): void {
  if (elevation === 0) return;
  context.save();
  const alpha = Math.min(.38, .055 * Math.abs(elevation));
  context.fillStyle = elevation > 0 ? `rgba(231, 218, 174, ${alpha})` : `rgba(19, 43, 55, ${alpha})`;
  context.fillRect(x, y, size, size);
  context.restore();
}

export function drawBuildingCell(
  context: CanvasRenderingContext2D,
  cell: BuildingCell,
  x: number,
  y: number,
  size: number,
): void {
  context.save();
  context.fillStyle = "#927a5b";
  context.fillRect(x + 1, y + 1, size - 2, size - 2);
  context.strokeStyle = "rgba(74, 55, 40, .48)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + size * .18, y + size * .76);
  context.lineTo(x + size * .82, y + size * .24);
  context.moveTo(x + size * .32, y + size * .88);
  context.lineTo(x + size * .92, y + size * .39);
  context.stroke();
  context.strokeStyle = "#d0b382";
  context.lineWidth = Math.max(2, size * .08);
  for (const wall of cell.walls) {
    context.beginPath();
    if (wall === "north") {
      context.moveTo(x, y); context.lineTo(x + size, y);
    } else if (wall === "east") {
      context.moveTo(x + size, y); context.lineTo(x + size, y + size);
    } else if (wall === "south") {
      context.moveTo(x + size, y + size); context.lineTo(x, y + size);
    } else {
      context.moveTo(x, y + size); context.lineTo(x, y);
    }
    context.stroke();
  }
  context.restore();
}

export function drawBuildingPlacementPreview(
  layout: CanvasLayout,
  valid: boolean,
  context: CanvasRenderingContext2D,
  origin: GridPosition,
  width: number,
  depth: number,
): void {
  context.save();
  context.fillStyle = valid ? "rgba(114, 156, 102, .3)" : "rgba(176, 66, 67, .3)";
  context.strokeStyle = valid ? "#a5d18d" : "#e47b7d";
  context.lineWidth = 2;
  context.setLineDash([5, 3]);
  const x = layout.originX + origin.x * layout.cellSize;
  const y = layout.originY + origin.y * layout.cellSize;
  context.fillRect(x, y, width * layout.cellSize, depth * layout.cellSize);
  context.strokeRect(x + 1, y + 1, width * layout.cellSize - 2, depth * layout.cellSize - 2);
  context.restore();
}

function edgeLine(layout: CanvasLayout, position: GridPosition, direction: Direction): [GridPosition, GridPosition] {
  const x = layout.originX + position.x * layout.cellSize;
  const y = layout.originY + position.y * layout.cellSize;
  const size = layout.cellSize;
  if (direction === "north") return [{ x, y }, { x: x + size, y }];
  if (direction === "east") return [{ x: x + size, y }, { x: x + size, y: y + size }];
  if (direction === "south") return [{ x: x + size, y: y + size }, { x, y: y + size }];
  return [{ x, y: y + size }, { x, y }];
}

export function drawEdgeFeature(layout: CanvasLayout, context: CanvasRenderingContext2D, feature: EdgeFeaturePlacement): void {
  const definition = edgeFeatureDefinition(feature.type);
  const [start, end] = edgeLine(layout, feature.position, feature.direction);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  context.save();
  context.lineCap = "square";

  if (definition.appearance === "hedge") {
    context.strokeStyle = cssColour(definition.wallColour);
    context.lineWidth = definition.height === "tall" ? Math.max(8, layout.cellSize * .22)
      : Math.max(5, layout.cellSize * .14);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.fillStyle = cssColour(definition.topColour);
    const leafRadius = definition.height === "tall" ? Math.max(2.5, layout.cellSize * .085)
      : Math.max(2, layout.cellSize * .065);
    for (let index = 0; index <= 8; index += 1) {
      const ratio = index / 8;
      const offset = (index % 2 === 0 ? -1 : 1) * leafRadius * .45;
      context.beginPath();
      context.arc(
        start.x + dx * ratio + normalX * offset,
        start.y + dy * ratio + normalY * offset,
        leafRadius,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.restore();
    return;
  }

  context.strokeStyle = cssColour(definition.wallColour);
  context.lineWidth = definition.height === "tall" ? Math.max(5, layout.cellSize * .17)
    : Math.max(3, layout.cellSize * .1);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.strokeStyle = cssColour(definition.roofColour ?? definition.topColour);
  context.lineWidth = definition.enclosure === "enclosed" ? Math.max(3, layout.cellSize * .09) : 2;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  if (definition.appearance === "stone_wall" || definition.appearance === "door") {
    const divisions = definition.appearance === "door" ? [0.25, 0.5, 0.75] : [0.2, 0.4, 0.6, 0.8];
    context.strokeStyle = definition.appearance === "door" ? "rgba(58, 35, 20, .82)" : "rgba(54, 55, 51, .68)";
    context.lineWidth = Math.max(1, layout.cellSize * .035);
    for (const ratio of divisions) {
      const px = start.x + dx * ratio;
      const py = start.y + dy * ratio;
      const half = definition.appearance === "door" ? Math.max(3, layout.cellSize * .09)
        : Math.max(2, layout.cellSize * .055);
      context.beginPath();
      context.moveTo(px - normalX * half, py - normalY * half);
      context.lineTo(px + normalX * half, py + normalY * half);
      context.stroke();
    }
  }

  if (definition.appearance === "door") {
    const handleRatio = .68;
    context.fillStyle = "#e0bd72";
    context.beginPath();
    context.arc(
      start.x + dx * handleRatio + normalX * Math.max(2, layout.cellSize * .055),
      start.y + dy * handleRatio + normalY * Math.max(2, layout.cellSize * .055),
      Math.max(1.5, layout.cellSize * .035),
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  if (definition.enclosure === "open") {
    context.fillStyle = cssColour(definition.topColour);
    for (const ratio of [0, .5, 1]) {
      const px = start.x + (end.x - start.x) * ratio;
      const py = start.y + (end.y - start.y) * ratio;
      context.beginPath();
      context.arc(px, py, Math.max(2, layout.cellSize * .06), 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

export function drawEdgeHover(
  layout: CanvasLayout,
  context: CanvasRenderingContext2D,
  position: GridPosition,
  direction: Direction,
  removing: boolean,
): void {
  const [start, end] = edgeLine(layout, position, direction);
  context.save();
  context.strokeStyle = removing ? "#ef7779" : "#f0cf76";
  context.lineWidth = Math.max(4, layout.cellSize * .13);
  context.setLineDash([6, 3]);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

export function drawRamp(
  context: CanvasRenderingContext2D,
  direction: Direction,
  x: number,
  y: number,
  size: number,
): void {
  if (size < 14) return;
  const vectors: Record<Direction, GridPosition> = {
    north: { x: 0, y: -1 }, east: { x: 1, y: 0 },
    south: { x: 0, y: 1 }, west: { x: -1, y: 0 },
  };
  const vector = vectors[direction];
  const centreX = x + size * .5;
  const centreY = y + size * .5;
  const endX = centreX + vector.x * size * .3;
  const endY = centreY + vector.y * size * .3;
  const angle = Math.atan2(vector.y, vector.x);
  const arrowSize = Math.max(3, size * .12);
  context.save();
  context.strokeStyle = "#f0cf76";
  context.fillStyle = "#f0cf76";
  context.lineWidth = Math.max(1.5, size * .055);
  context.beginPath();
  context.moveTo(centreX - vector.x * size * .2, centreY - vector.y * size * .2);
  context.lineTo(endX, endY);
  context.stroke();
  context.beginPath();
  context.moveTo(endX, endY);
  context.lineTo(endX - Math.cos(angle - .62) * arrowSize, endY - Math.sin(angle - .62) * arrowSize);
  context.lineTo(endX - Math.cos(angle + .62) * arrowSize, endY - Math.sin(angle + .62) * arrowSize);
  context.closePath();
  context.fill();
  context.restore();
}

export function drawElevationBadge(
  context: CanvasRenderingContext2D,
  elevation: number,
  x: number,
  y: number,
  size: number,
): void {
  if (size < 18) return;
  const label = `${elevation >= 0 ? "+" : ""}${elevation}`;
  context.save();
  context.font = `700 ${Math.max(7, Math.floor(size * .18))}px ui-monospace, monospace`;
  const width = context.measureText(label).width + 5;
  context.fillStyle = elevation === 0 ? "rgba(17, 22, 17, .5)" : "rgba(17, 22, 17, .82)";
  context.fillRect(x + 2, y + 2, width, Math.max(10, size * .24));
  context.fillStyle = elevation > 0 ? "#f0dca1" : elevation < 0 ? "#a9d1dc" : "#98a08f";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(label, x + 4, y + 3);
  context.restore();
}

export function drawObject(
  context: CanvasRenderingContext2D,
  object: TerrainObjectType,
  x: number,
  y: number,
  size: number,
  stackIndex: number,
): void {
  const offsetX = (stackIndex % 3 - 1) * size * .13;
  const offsetY = (Math.floor(stackIndex / 3) - .3) * size * .11;
  const centreX = x + size * .5 + offsetX;
  const centreY = y + size * .53 + offsetY;
  const scale = object.endsWith("large") || object === "pond" ? .34 : .23;
  const radius = Math.max(2.5, size * scale);
  context.save();
  if (object.startsWith("tree")) {
    context.fillStyle = "#5b4430";
    context.fillRect(centreX - Math.max(1, size * .035), centreY, Math.max(2, size * .07), radius * .65);
    context.fillStyle = object === "tree_large" ? "#17331e" : "#28502c";
    context.beginPath();
    context.arc(centreX, centreY - radius * .18, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(184, 207, 154, .45)";
    context.lineWidth = 1;
    context.stroke();
  } else if (object.startsWith("rock")) {
    context.fillStyle = object === "rock_large" ? "#646860" : "#777b70";
    context.beginPath();
    context.moveTo(centreX - radius, centreY + radius * .55);
    context.lineTo(centreX - radius * .55, centreY - radius * .62);
    context.lineTo(centreX + radius * .35, centreY - radius);
    context.lineTo(centreX + radius, centreY + radius * .42);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(225, 223, 207, .5)";
    context.stroke();
  } else {
    context.fillStyle = "#2c6268";
    context.beginPath();
    context.ellipse(centreX, centreY, radius * 1.25, radius * .7, -.12, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#72aaa8";
    context.stroke();
  }
  context.restore();
}

export function drawSpawnPoint(
  context: CanvasRenderingContext2D,
  spawnPoint: MapSpawnPoint,
  x: number,
  y: number,
  size: number,
): void {
  const colour = spawnPoint.factionId === "roman" ? "#e35a60" : "#e0a052";
  context.save();
  context.strokeStyle = colour;
  context.fillStyle = spawnPoint.factionId === "roman" ? "rgba(155, 52, 56, .22)" : "rgba(161, 106, 53, .22)";
  context.lineWidth = Math.max(1, size * .07);
  context.setLineDash([Math.max(2, size * .14), Math.max(2, size * .09)]);
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size * .36, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(x + size * .5, y + size * .28);
  context.lineTo(x + size * .5, y + size * .72);
  context.moveTo(x + size * .28, y + size * .5);
  context.lineTo(x + size * .72, y + size * .5);
  context.stroke();
  context.restore();
}

export function drawDeploymentBlock(
  context: CanvasRenderingContext2D,
  deployment: MapFormationDeployment,
  position: GridPosition,
  x: number,
  y: number,
  size: number,
): void {
  const colour = deployment.factionId === "roman" ? "#a83b40" : "#aa6b34";
  const connected = (dx: number, dy: number) => deployment.positions.some(
    (candidate) => candidate.x === position.x + dx && candidate.y === position.y + dy,
  );
  context.save();
  context.fillStyle = colour;
  if (connected(1, 0)) context.fillRect(x + size * .5, y + size * .28, size, size * .44);
  if (connected(0, 1)) context.fillRect(x + size * .28, y + size * .5, size * .44, size);
  const inset = Math.max(2, size * .12);
  context.fillStyle = colour;
  context.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  context.strokeStyle = deployment.factionId === "roman" ? "#f2a4a7" : "#f0bc78";
  context.lineWidth = Math.max(1, size * .045);
  context.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  if (size >= 20) {
    context.fillStyle = "#fff1ce";
    context.font = `700 ${Math.max(8, Math.floor(size * .27))}px Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(deployment.factionId === "roman" ? "R" : "S", x + size / 2, y + size / 2 + 1);
  }
  context.restore();
}

export function drawCoordinates(layout: CanvasLayout, map: BattlefieldMap, context: CanvasRenderingContext2D, boardWidth: number, boardHeight: number): void {
  if (layout.cellSize < 15) return;
  context.fillStyle = "#7f8579";
  context.font = "8px ui-monospace, monospace";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  for (let x = 0; x < map.width; x += 1) {
    if (x !== 0 && x !== map.width - 1 && x % 5 !== 0) continue;
    context.fillText(String(x), layout.originX + (x + .5) * layout.cellSize, layout.originY - 7);
  }
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let y = 0; y < map.height; y += 1) {
    if (y !== 0 && y !== map.height - 1 && y % 5 !== 0) continue;
    context.fillText(String(y), layout.originX - 7, layout.originY + (y + .5) * layout.cellSize);
  }
  context.strokeStyle = "rgba(221, 197, 137, .55)";
  context.lineWidth = 1;
  context.strokeRect(layout.originX - .5, layout.originY - .5, boardWidth + 1, boardHeight + 1);
}
