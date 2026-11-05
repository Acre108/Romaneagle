export const ISO_DEPTH_PRIORITY = {
  terrain: 0,
  groundHighlight: 10,
  blockShadow: 20,
  blockBase: 30,
  soldier: 40,
  character: 50,
  effect: 60,
  floatingLabel: 70,
} as const;

export function calculateIsoDepth(gridX: number, gridY: number, localPriority = 0): number {
  return (gridX + gridY) * 10_000 + gridY * 100 + gridX + localPriority;
}

export function calculateIsoBoundaryDepth(
  behindX: number,
  behindY: number,
  foregroundX: number,
  foregroundY: number,
  localPriority = 0,
): number {
  const behindDepth = calculateIsoDepth(behindX, behindY, localPriority);
  const foregroundDepth = calculateIsoDepth(foregroundX, foregroundY, localPriority);
  return (behindDepth + foregroundDepth) / 2;
}
