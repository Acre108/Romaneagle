import type { Graphics } from "pixi.js";

export function drawFallenBody(graphics: Graphics, x: number, y: number, angle: number): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle) * 0.55;
  const px = -dy;
  const py = dx * 0.55;
  const headX = x - dx * 5;
  const headY = y - dy * 5;
  const hipX = x + dx * 4;
  const hipY = y + dy * 4;
  graphics.ellipse(x, y + 2, 6.5, 2.4).fill({ color: 0x57161b, alpha: 0.52 })
    .moveTo(headX + dx * 2, headY + dy * 2).lineTo(hipX, hipY)
    .stroke({ width: 3.2, color: 0x35261f, cap: "round" })
    .circle(headX, headY, 2.2)
    .fill(0xb9a184)
    .stroke({ width: 0.7, color: 0x30251e, alpha: 0.9 })
    .moveTo(x - px * 3.5, y - py * 3.5).lineTo(x + px * 3.5, y + py * 3.5)
    .moveTo(hipX, hipY).lineTo(hipX + dx * 3 + px * 2, hipY + dy * 3 + py * 2)
    .moveTo(hipX, hipY).lineTo(hipX + dx * 3 - px * 2, hipY + dy * 3 - py * 2)
    .stroke({ width: 1.5, color: 0x2b211c, cap: "round" });
}

export function drawSkullIcon(graphics: Graphics, x: number, y: number): void {
  graphics.circle(x, y, 6).fill({ color: 0xffedbd, alpha: 0.1 })
    .circle(x, y, 4.1)
    .fill(0xe9dfc5)
    .stroke({ width: 0.9, color: 0x3a332a, alpha: 0.95 })
    .roundRect(x - 2.6, y + 2, 5.2, 3.2, 1)
    .fill(0xd6c9aa)
    .stroke({ width: 0.7, color: 0x3a332a, alpha: 0.9 })
    .circle(x - 1.45, y - 0.5, 0.9).fill(0x302a24)
    .circle(x + 1.45, y - 0.5, 0.9).fill(0x302a24)
    .poly([x, y + 0.2, x - 0.7, y + 1.4, x + 0.7, y + 1.4], true).fill(0x51483b)
    .moveTo(x - 1.6, y + 3.4).lineTo(x + 1.6, y + 3.4)
    .moveTo(x, y + 2.7).lineTo(x, y + 4.2)
    .stroke({ width: 0.65, color: 0x746a59, alpha: 0.9 });
}
