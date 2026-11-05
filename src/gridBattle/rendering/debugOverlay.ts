import { Container, Graphics, Text } from "pixi.js";
import type { Direction, GameState, GridPosition } from "../model/types";
import { attackingPressure, defendingResistance } from "../rules/combat";
import { directionVector } from "../rules/direction";
import { componentIndexForBlock } from "../rules/splitting";
import { ISO_METRICS, MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM } from "./isometric/IsoConfig";
import { calculateIsoDepth, ISO_DEPTH_PRIORITY } from "./isometric/IsoDepth";
import { fractionalGridToIso, type ScreenPosition } from "./isometric/IsoProjection";
import type { BoardView } from "./orderPreviewOverlay";
import { blockFormation } from "../model/occupancy";

function projectedDirection(direction: Direction, length = 1): ScreenPosition {
  const vector = directionVector(direction);
  return fractionalGridToIso({ x: vector.x * length, y: vector.y * length }, ISO_METRICS);
}

export function drawDebugLabels(layer: Container, view: BoardView, state: GameState): void {
  for (const block of Object.values(state.blocks)) {
    const iso = view.projectTile(block.position);
    const component = block.formationId ? componentIndexForBlock(state, block.formationId, block.id) : -1;
    const formation = blockFormation(state, block);
    const label = new Text({
      text: `${block.position.x},${block.position.y} · z${calculateIsoDepth(block.position.x, block.position.y)}\n${block.id} · C${component}\nM${block.models} W${block.wavering ? 1 : 0} P${attackingPressure(state, block.id)} R${defendingResistance(state, block.id, formation?.facing ?? "north")}`,
      style: { fontFamily: "Arial", fontSize: 7, fill: 0xffffff, stroke: { color: 0x000000, width: 2 }, align: "center" },
    });
    label.anchor.set(0.5, 1);
    label.position.set(iso.x, iso.y - 42);
    label.zIndex = calculateIsoDepth(block.position.x, block.position.y, ISO_DEPTH_PRIORITY.floatingLabel);
    layer.addChild(label);
  }
}

export function drawDebugCandidates(layer: Container, view: BoardView, state: GameState | null, candidates: readonly GridPosition[]): void {
  const hovered = view.hoveredCell();
  const g = new Graphics();
  for (const candidate of candidates) {
    if (!state || candidate.x < 0 || candidate.y < 0
      || candidate.x >= state.battlefield.width || candidate.y >= state.battlefield.height) continue;
    g.poly(view.surfaceDiamond(candidate, 0.76), true).stroke({ width: 1, color: 0x73b8e6, alpha: 0.62 });
  }
  if (hovered) {
    g.poly(view.surfaceDiamond(hovered, 0.68), true)
      .fill({ color: 0xffffff, alpha: 0.13 })
      .stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
  }
  layer.addChild(g);
}

export function debugReadoutText(
  view: BoardView,
  camera: Readonly<{ x: number; y: number; zoom: number }>,
  candidates: readonly GridPosition[],
  localPointer: ScreenPosition | null,
): string {
  const hovered = view.hoveredCell();
  const projected = hovered ? view.projectTile(hovered) : null;
  return [
    `Camera ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)} · zoom ${camera.zoom.toFixed(2)}`,
    hovered ? `Picked ${hovered.x},${hovered.y} · iso ${projected!.x.toFixed(0)},${projected!.y.toFixed(0)} · depth ${calculateIsoDepth(hovered.x, hovered.y)}` : "Picked —",
    `Candidates ${candidates.map((position) => `${position.x},${position.y}`).join(" · ") || "—"}`,
    localPointer ? `Local pointer ${localPointer.x.toFixed(1)}, ${localPointer.y.toFixed(1)}` : "Local pointer —",
    `Zoom range ${MIN_CAMERA_ZOOM.toFixed(2)}–${MAX_CAMERA_ZOOM.toFixed(2)}`,
  ].join("\n");
}

export function drawAxes(layer: Container): void {
  const group = new Container({ label: "isoAxes" });
  group.position.set(92, 108);
  const g = new Graphics().circle(0, 0, 4).fill(0xf1dfaa);
  const labels: { direction: Direction; text: string }[] = [
    { direction: "north", text: "N" }, { direction: "east", text: "E" },
    { direction: "south", text: "S" }, { direction: "west", text: "W" },
  ];
  for (const item of labels) {
    const vector = projectedDirection(item.direction, 0.75);
    g.moveTo(0, 0).lineTo(vector.x, vector.y).stroke({ width: 3, color: 0xe3cd91, alpha: 0.92 });
    const text = new Text({ text: item.text, style: { fontFamily: "Arial", fontSize: 12, fontWeight: "700", fill: 0xffedbd } });
    text.anchor.set(0.5);
    text.position.set(vector.x * 1.22, vector.y * 1.22);
    group.addChild(text);
  }
  group.addChildAt(g, 0);
  layer.addChild(group);
}
