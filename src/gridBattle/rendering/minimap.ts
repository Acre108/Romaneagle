import { edgeFeatureDefinition } from "../model/edgeFeatureDefinitions";
import { groundTextureAt, terrainAt } from "../model/terrain";
import { groundTextureDefinition, terrainDefinition } from "../model/terrainDefinitions";
import type { GameState, TroopBlock } from "../model/types";
import type { ScreenPosition } from "./isometric/IsoProjection";

/** The top-down map: terrain, edges, blocks, and an outline of what the camera can see. */
export function drawMinimap(
  canvas: HTMLCanvasElement,
  state: GameState,
  blockFill: (block: TroopBlock) => string,
  viewCorners: readonly ScreenPosition[],
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const cellWidth = canvas.width / state.battlefield.width;
  const cellHeight = canvas.height / state.battlefield.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < state.battlefield.height; y += 1) {
    for (let x = 0; x < state.battlefield.width; x += 1) {
      const terrain = terrainAt(state, { x, y })!;
      const texture = terrain === "building" ? undefined : groundTextureAt(state, { x, y });
      context.fillStyle = texture
        ? groundTextureDefinition(texture).minimapColour
        : terrainDefinition(terrain).minimapColour;
      context.fillRect(x * cellWidth, y * cellHeight, Math.ceil(cellWidth), Math.ceil(cellHeight));
    }
  }
  for (const feature of state.battlefield.edgeFeatures) {
    const definition = edgeFeatureDefinition(feature.type);
    const left = feature.position.x * cellWidth;
    const top = feature.position.y * cellHeight;
    context.beginPath();
    switch (feature.direction) {
      case "north": context.moveTo(left, top); context.lineTo(left + cellWidth, top); break;
      case "east": context.moveTo(left + cellWidth, top); context.lineTo(left + cellWidth, top + cellHeight); break;
      case "south": context.moveTo(left, top + cellHeight); context.lineTo(left + cellWidth, top + cellHeight); break;
      case "west": context.moveTo(left, top); context.lineTo(left, top + cellHeight); break;
    }
    context.strokeStyle = definition.minimapColour;
    context.lineWidth = definition.height === "tall" ? 3 : 2;
    context.stroke();
  }
  for (const block of Object.values(state.blocks)) {
    context.fillStyle = blockFill(block);
    context.fillRect(block.position.x * cellWidth + 1, block.position.y * cellHeight + 1, cellWidth - 2, cellHeight - 2);
  }
  context.beginPath();
  viewCorners.forEach((corner, index) => {
    const x = (corner.x + 0.5) * cellWidth;
    const y = (corner.y + 0.5) * cellHeight;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.closePath();
  context.strokeStyle = "#ffe5a5";
  context.lineWidth = 2;
  context.stroke();
}
