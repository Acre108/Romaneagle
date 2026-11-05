import { Graphics, type Container } from "pixi.js";
import type { GameState, GridPosition } from "../model/types";
import { chargePreview } from "../rules/charge";
import { addPosition, directionVector } from "../rules/direction";
import { legalReformDestinations } from "../rules/formationActions";
import { legalMoveDirections, planFormationMove } from "../rules/movement";
import { rangedAttackPreview } from "../rules/rangedCombat";
import type { BoardView } from "./orderPreviewOverlay";

function drawPreviewCell(layer: Container, view: BoardView, position: GridPosition, colour: number, alpha = 0.3): void {
  const graphic = new Graphics()
    .poly(view.surfaceDiamond(position, 0.88), true)
    .fill({ color: colour, alpha })
    .stroke({ width: 3, color: colour, alpha: 0.95 });
  graphic.eventMode = "none";
  layer.addChild(graphic);
}

function drawArrow(layer: Container, view: BoardView, from: GridPosition, to: GridPosition, colour: number): void {
  const start = view.projectTile(from);
  const end = view.projectTile(to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const g = new Graphics()
    .moveTo(start.x + ux * 18, start.y + uy * 9)
    .lineTo(end.x - ux * 18, end.y - uy * 9)
    .stroke({ width: 4, color: colour, alpha: 0.9 });
  const tipX = end.x - ux * 14;
  const tipY = end.y - uy * 7;
  g.poly([
    tipX, tipY,
    tipX - ux * 10 - uy * 6, tipY - uy * 10 + ux * 6,
    tipX - ux * 10 + uy * 6, tipY - uy * 10 - ux * 6,
  ], true).fill(colour);
  layer.addChild(g);
}

function drawRangedParticipationPips(layer: Container, view: BoardView, position: GridPosition, count: number): void {
  const centre = view.projectTile(position);
  const graphics = new Graphics();
  const columns = Math.min(5, count);
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / 5);
    const column = index % 5;
    const rowColumns = row === Math.floor((count - 1) / 5) ? ((count - 1) % 5) + 1 : columns;
    const x = (column - (rowColumns - 1) / 2) * 6;
    const y = -13 - row * 6;
    graphics.circle(centre.x + x, centre.y + y, 2.2)
      .fill({ color: 0xffe69a, alpha: 0.96 })
      .stroke({ width: 1, color: 0x493215, alpha: 0.9 });
  }
  layer.addChild(graphics);
}

/** Highlights where the chosen order can go, before the player picks a target. */
export function drawActionPreviews(state: GameState, layer: Container, view: BoardView): void {
  const formation = state.selectedFormationId ? state.formations[state.selectedFormationId] : undefined;
  if (!formation || !state.currentAction) return;
  if (state.currentAction === "move") {
    for (const direction of legalMoveDirections(state, formation.id)) {
      const plan = planFormationMove(state, formation.id, direction).plan;
      if (!plan) continue;
      for (const relocation of plan.relocations) drawPreviewCell(layer, view, relocation.destination, plan.reordered ? 0xd4a85e : 0x79b88e, plan.reordered ? 0.22 : 0.18);
    }
    return;
  }
  if (state.currentAction === "reform" && state.selectedBlockId) {
    for (const position of legalReformDestinations(state, state.selectedBlockId)) drawPreviewCell(layer, view, position, 0x7acb92, 0.38);
    return;
  }
  if (state.currentAction === "shoot") {
    const firingSourceIds = new Set<string>();
    for (const defender of Object.values(state.blocks)) {
      if (defender.factionId === formation.factionId) continue;
      const preview = rangedAttackPreview(state, formation.id, defender.id);
      if (!preview) continue;
      const targetAlpha = 0.16 + preview.firingIntensity * 0.46;
      drawPreviewCell(layer, view, defender.position, 0xc56f5f, targetAlpha);
      drawRangedParticipationPips(layer, view, defender.position, preview.firingBlockCount);
      for (const sourceBlockId of preview.sourceBlockIds) {
        const source = state.blocks[sourceBlockId];
        if (!source) continue;
        firingSourceIds.add(source.id);
      }
    }
    for (const sourceBlockId of firingSourceIds) {
      const source = state.blocks[sourceBlockId];
      if (source) drawPreviewCell(layer, view, source.position, 0xe0c877, 0.18);
    }
    return;
  }
  for (const attackerId of formation.blockIds) {
    const attacker = state.blocks[attackerId];
    if (!attacker) continue;
    for (const defender of Object.values(state.blocks)) {
      if (state.currentAction === "charge") {
        const preview = chargePreview(state, attackerId, defender.id);
        if (!preview) continue;
        const vector = directionVector(formation.facing);
        for (let distance = 1; distance <= preview.distance; distance += 1) {
          drawPreviewCell(layer, view, addPosition(attacker.position, vector, distance), 0xe2a84d, 0.18 + distance * 0.025);
        }
        drawArrow(layer, view, attacker.position, defender.position, 0xffbe55);
      }
    }
  }
}
