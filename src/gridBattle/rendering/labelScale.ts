/**
 * How much to enlarge a world-space label so its text is at least `minimumShownPx` tall on screen.
 * `shownPerWorldUnit` is screen pixels per world unit: camera zoom times any CSS scaling of the canvas.
 * Labels never shrink below their drawn size.
 */
export function readableLabelScale(fontSize: number, minimumShownPx: number, shownPerWorldUnit: number): number {
  if (!(shownPerWorldUnit > 0) || !(fontSize > 0)) return 1;
  return Math.max(1, minimumShownPx / (fontSize * shownPerWorldUnit));
}
