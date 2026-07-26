import type { BattleStandard } from "../systems/Simulation";
import { FACTION_STYLE } from "../units/types";

const POLE_HEIGHT = 30;
const CARRIED_OFFSET_X = 13;

export function drawBattleStandardScreen(
  ctx: CanvasRenderingContext2D,
  standard: BattleStandard,
  screenX: number,
  screenY: number,
): void {
  const style = FACTION_STYLE[standard.faction];
  const dropped = standard.status === "dropped";
  ctx.save();
  ctx.translate(screenX + (dropped ? 0 : CARRIED_OFFSET_X), screenY);
  if (dropped) ctx.rotate(-1.08);
  ctx.strokeStyle = "#4b3825";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 1);
  ctx.lineTo(0, -POLE_HEIGHT);
  ctx.stroke();
  ctx.fillStyle = style.primary;
  ctx.beginPath();
  ctx.moveTo(1, -POLE_HEIGHT);
  ctx.lineTo(19, -POLE_HEIGHT + 4);
  ctx.lineTo(1, -POLE_HEIGHT + 11);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = standard.status === "captured" ? "#f1e5be" : style.detail;
  ctx.lineWidth = standard.status === "captured" ? 1.8 : 1.2;
  ctx.stroke();
  ctx.fillStyle = style.detail;
  ctx.beginPath();
  ctx.arc(0, -POLE_HEIGHT - 2, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
