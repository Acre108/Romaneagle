export interface PlateRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PLATE_GAP = 2;
/** Each move clears the gap by more than rounding error, so the search below always moves on. */
const PLATE_STEP = PLATE_GAP + 1;

function overlaps(a: PlateRect, b: PlateRect): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + PLATE_GAP;
}

/**
 * Returns the y of each plate so that none covers another. Rects are centred on x and y.
 * The plate nearest the viewer stays put and those behind it move up, keeping each name above its own troops.
 */
export function spreadPlates(plates: readonly PlateRect[]): number[] {
  const order = plates.map((_, index) => index)
    .sort((left, right) => plates[right]!.y - plates[left]!.y || left - right);
  const placed: PlateRect[] = [];
  const result = plates.map((plate) => plate.y);
  for (const index of order) {
    const rect = { ...plates[index]! };
    let blocker = placed.find((other) => overlaps(rect, other));
    while (blocker) {
      rect.y = blocker.y - (blocker.height + rect.height) / 2 - PLATE_STEP;
      blocker = placed.find((other) => overlaps(rect, other));
    }
    placed.push(rect);
    result[index] = rect.y;
  }
  return result;
}
