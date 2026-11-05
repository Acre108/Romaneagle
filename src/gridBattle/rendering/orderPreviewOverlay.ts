import { Container, Graphics, Rectangle, Text } from "pixi.js";
import { positionKey, samePosition } from "../model/occupancy";
import type { GridPosition, OrderConfirmationPreview } from "../model/types";
import type { ScreenPosition } from "./isometric/IsoProjection";

/** What overlays need to know about the board: where a square is on screen, and which square is under the pointer. */
export interface BoardView {
  projectTile(position: GridPosition): ScreenPosition;
  surfaceDiamond(position: GridPosition, scale?: number): number[];
  hoveredCell(): GridPosition | null;
  /** Replaces block ids in a line of text with the names players know. */
  describe(text: string): string;
}

interface PreviewMathHitArea {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreviewBubblePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

function previewBubblesOverlap(a: PreviewBubblePlacement, b: PreviewBubblePlacement, padding = 5): boolean {
  return a.x < b.x + b.width + padding
    && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding
    && a.y + a.height + padding > b.y;
}

/** The tiles, damage bubbles and calculation pop-ups shown while an order waits for confirmation. */
export class OrderPreviewOverlay {
  private preview: OrderConfirmationPreview | null = null;
  private expandedMathKey: string | null = null;
  private readonly hitAreas: PreviewMathHitArea[] = [];

  constructor(private readonly layer: Container, private readonly view: BoardView) {}

  get current(): OrderConfirmationPreview | null {
    return this.preview;
  }

  setPreview(preview: OrderConfirmationPreview | null): void {
    if (this.preview !== preview) this.expandedMathKey = null;
    this.preview = preview;
  }

  /** The layer itself is emptied with the other dynamic layers; its click targets go with it. */
  clearHitAreas(): void {
    this.hitAreas.length = 0;
  }

  private contains(area: PreviewMathHitArea, point: ScreenPosition): boolean {
    return point.x >= area.x && point.x <= area.x + area.width
      && point.y >= area.y && point.y <= area.y + area.height;
  }

  isOverPositionControl(point: ScreenPosition): boolean {
    return this.hitAreas.some((area) => area.key.startsWith("position:") && this.contains(area, point));
  }

  /** The topmost control at this point, if any. */
  controlAt(point: ScreenPosition): string | null {
    return [...this.hitAreas].reverse().find((area) => this.contains(area, point))?.key ?? null;
  }

  /** Percentages follow the pointer, so they redraw when it moves to another square. */
  handleHoverChanged(): void {
    if (!this.preview) return;
    if (this.expandedMathKey?.startsWith("position:")) this.expandedMathKey = null;
    this.redraw();
  }

  toggleMath(key: string): void {
    this.expandedMathKey = this.expandedMathKey === key ? null : key;
    this.redraw();
  }

  private redraw(): void {
    this.layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.hitAreas.length = 0;
    this.draw();
  }

  draw(): void {
    const preview = this.preview;
    if (!preview) return;
    const visibleTiles = preview.tiles.filter((tile) => tile.chance > 0);
    for (const tile of visibleTiles) {
      const centre = this.view.projectTile(tile.position);
      const colour = tile.factionId === "roman" ? 0x73b4ef : 0xe0aa65;
      const group = new Container({ label: `order-${tile.certainty}-${positionKey(tile.position)}` });
      const shadow = new Graphics()
        .poly(this.view.surfaceDiamond(tile.position, 0.78), true)
        .fill({ color: 0x10130f, alpha: 0.52 })
        .stroke({ width: 3, color: colour, alpha: tile.certainty === "certain" ? 0.9 : 0.65 });
      const key = `position:${tile.factionId}:${positionKey(tile.position)}`;
      const hovered = this.view.hoveredCell();
        const showPercentage = hovered !== null && samePosition(tile.position, hovered);
      group.addChild(shadow);
      if (showPercentage) {
        const marker = this.createPreviewSpeechButton(
          key,
          `${tile.chance}%`,
          `${tile.chance}% chance ${tile.blockId ? this.view.describe(tile.blockId) : "a block"} ends in ${String.fromCharCode(65 + tile.position.x)}${tile.position.y + 1}. Activate for calculation.`,
          colour,
          58,
        );
        marker.position.set(centre.x + (tile.factionId === "roman" ? -62 : 4), centre.y - 47);
        this.hitAreas.push({ key, x: marker.x, y: marker.y, width: 58, height: 31 });
        group.addChild(marker);
      } else {
        const marker = new Text({
          text: tile.chance === 100 ? "!" : "?",
          style: {
            fontFamily: "Arial",
            fontSize: 25,
            fontWeight: "900",
            fill: colour,
            stroke: { color: 0x10130f, width: 4 },
          },
        });
        marker.anchor.set(0.5);
        marker.position.set(centre.x, centre.y - 7);
        marker.eventMode = "none";
        group.addChild(marker);
      }
      group.eventMode = "passive";
      this.layer.addChild(group);
    }
    const damagePlacements: PreviewBubblePlacement[] = [];
    for (const damage of preview.damage) {
      const centre = this.view.projectTile(damage.position);
      const colour = damage.factionId === "roman" ? 0x73b4ef : 0xe0aa65;
      const key = `damage:${damage.blockId}`;
      const mitigationLabel = damage.mitigationLabel ?? "evade";
      const damageText = damage.minimumDamage === damage.maximumDamage ? `${damage.maximumDamage} dmg` : `${damage.minimumDamage}–${damage.maximumDamage} dmg`;
      const label = damage.evadeChance > 0 ? `${damageText}\n${damage.evadeChance}% ${mitigationLabel}` : damageText;
      const group = new Container({ label: `damage-${damage.blockId}` });
      const bubble = this.createPreviewSpeechButton(
        key,
        label,
        `${this.view.describe(damage.blockId)} takes ${damage.minimumDamage} to ${damage.maximumDamage} damage with ${damage.evadeChance}% ${mitigationLabel}. Activate for calculation.`,
        colour,
        78,
      );
      const direction = damage.factionId === "roman" ? -1 : 1;
      const candidates = [
        { x: direction * 22, y: 0 },
        { x: direction * 66, y: -5 },
        { x: direction * 22, y: -45 },
        { x: direction * 110, y: -10 },
        { x: direction * 66, y: -50 },
        { x: direction * 22, y: -90 },
        { x: direction * 154, y: -15 },
        { x: direction * 110, y: -55 },
      ];
      let placement: PreviewBubblePlacement = {
        x: centre.x - 39 + candidates[0]!.x,
        y: centre.y - 105 + candidates[0]!.y,
        width: 78,
        height: 40,
      };
      for (const candidate of candidates) {
        const next = {
          x: centre.x - 39 + candidate.x,
          y: centre.y - 105 + candidate.y,
          width: 78,
          height: 40,
        };
        placement = next;
        if (!damagePlacements.some((placed) => previewBubblesOverlap(next, placed))) break;
      }
      while (damagePlacements.some((placed) => previewBubblesOverlap(placement, placed))) {
        placement = { ...placement, x: placement.x + direction * 44, y: placement.y - 5 };
      }
      damagePlacements.push(placement);
      bubble.position.set(placement.x, placement.y);
      this.hitAreas.push({ key, x: bubble.x, y: bubble.y, width: 78, height: 40 });
      group.addChild(bubble);
      group.eventMode = "passive";
      this.layer.addChild(group);
    }
    const expandedTile = visibleTiles.find((tile) =>
      `position:${tile.factionId}:${positionKey(tile.position)}` === this.expandedMathKey);
    const expandedDamage = preview.damage.find((damage) => `damage:${damage.blockId}` === this.expandedMathKey);
    if (expandedTile || expandedDamage) {
      const item = expandedTile ?? expandedDamage!;
      const centre = this.view.projectTile(item.position);
      const colour = item.factionId === "roman" ? 0x73b4ef : 0xe0aa65;
      const detail = new Container({ label: "expandedPreviewMath" });
      this.addPreviewMathBubble(
        detail,
        centre.x - 155,
        centre.y + (expandedTile ? 34 : -178),
        item.math.map((line) => this.view.describe(line)),
        colour,
      );
      detail.eventMode = "none";
      this.layer.addChild(detail);
    }
  }

  private createPreviewSpeechButton(
    key: string,
    label: string,
    accessibleTitle: string,
    colour: number,
    width: number,
  ): Container {
    const height = label.includes("\n") ? 34 : 25;
    const button = new Container({ label: key });
    const background = new Graphics()
      .roundRect(0, 0, width, height, 6)
      .fill({ color: 0x151912, alpha: 0.96 })
      .stroke({ width: 1.5, color: colour, alpha: 0.95 })
      .poly([width / 2 - 5, height, width / 2 + 5, height, width / 2, height + 6], true)
      .fill({ color: 0x151912, alpha: 0.96 })
      .stroke({ width: 1, color: colour, alpha: 0.9 });
    const text = new Text({
      text: label,
      style: { fontFamily: "Arial", fontSize: 10, fontWeight: "700", fill: 0xffedbd },
    });
    text.anchor.set(0, 0.5);
    text.position.set(6, height / 2);
    const info = new Graphics().circle(width - 10, height / 2, 6).fill(colour);
    const infoText = new Text({
      text: "i",
      style: { fontFamily: "Arial", fontSize: 9, fontWeight: "900", fill: 0x151912 },
    });
    infoText.anchor.set(0.5);
    infoText.position.set(width - 10, height / 2 - 0.5);
    button.addChild(background, text, info, infoText);
    button.eventMode = "static";
    button.cursor = "pointer";
    button.hitArea = new Rectangle(0, 0, width, height + 6);
    button.accessible = true;
    button.accessibleTitle = accessibleTitle;
    button.accessibleHint = "Shows or hides the combat calculation.";
    button.tabIndex = 0;
    button.on("pointertap", (event) => {
      const nativeType = (event.nativeEvent as Event | undefined)?.type ?? "";
      if (nativeType.startsWith("pointer")) return;
      event.stopPropagation();
      this.toggleMath(key);
    });
    return button;
  }

  private addPreviewMathBubble(
    parent: Container,
    x: number,
    y: number,
    lines: readonly string[],
    colour: number,
  ): void {
    const width = 310;
    const text = new Text({
      text: lines.join("\n"),
      style: {
        fontFamily: "Arial",
        fontSize: 12,
        lineHeight: 17,
        fill: 0xe8e1cf,
        wordWrap: true,
        wordWrapWidth: width - 16,
      },
    });
    text.position.set(x + 8, y + 7);
    const height = text.height + 14;
    const background = new Graphics()
      .roundRect(x, y, width, height, 6)
      .fill({ color: 0x11150f, alpha: 0.98 })
      .stroke({ width: 1.5, color: colour, alpha: 0.95 });
    background.eventMode = "none";
    text.eventMode = "none";
    parent.addChild(background, text);
  }
}
