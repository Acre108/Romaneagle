import { ROUTING_DECISION_SECONDS, type Unit } from "./types";

export type UnitActivityStatus =
  | "reorganising"
  | "repathing"
  | "flanked"
  | "lowAmmo"
  | "outOfAmmo"
  | "charging"
  | "inspired"
  | "winning"
  | "pressed"
  | "closing"
  | "engaged"
  | "idle";

export const UNIT_STATUS_STYLE = {
  reorganising: { fill: "rgba(41,49,55,.9)", border: "#89939b", text: "#eef0ed" },
  repathing: { fill: "rgba(83,55,18,.92)", border: "#d89a45", text: "#ffe4b0" },
  flanked: { fill: "rgba(92,47,18,.92)", border: "#e19245", text: "#ffe0aa" },
  lowAmmo: { fill: "rgba(83,55,18,.92)", border: "#d89a45", text: "#ffe4b0" },
  outOfAmmo: { fill: "rgba(87,32,25,.94)", border: "#d65f4f", text: "#ffe0d8" },
  charging: { fill: "rgba(78,59,16,.92)", border: "#dbb44c", text: "#fff0ad" },
  inspired: { fill: "rgba(72,57,20,.92)", border: "#d6b45d", text: "#fff1bd" },
  winning: { fill: "rgba(28,65,35,.92)", border: "#77ad69", text: "#e1f5da" },
  pressed: { fill: "rgba(82,40,25,.92)", border: "#c87553", text: "#ffd7c7" },
  closing: { fill: "rgba(44,49,42,.92)", border: "#7f8d78", text: "#e2eadc" },
  engaged: { fill: "rgba(48,48,39,.92)", border: "#999376", text: "#eee8d5" },
  idle: { fill: "rgba(27,31,26,.84)", border: "#696d60", text: "#d5d7ce" },
} as const;

export function getUnitActivityStatus(unit: Unit): UnitActivityStatus {
  if (unit.formationChangeTimer > 0) return "reorganising";
  if (unit.pathingState === "fallback") return "repathing";
  if (unit.vulnerableTimer > 0) return "flanked";
  if (unit.type === "archers" && unit.ammunition <= 0) return "outOfAmmo";
  if (
    unit.type === "archers" &&
    unit.ammunition <= Math.ceil(unit.maximumAmmunition * 0.25)
  ) return "lowAmmo";
  if (unit.chargeTargetId || unit.chargeBonusTimer > 0) return "charging";
  if (!unit.inCombat && unit.standardMoraleBoost) return "inspired";
  if (
    !unit.inCombat &&
    (unit.order.type === "attack" || unit.aiTargetId !== undefined)
  ) return "closing";
  if (!unit.inCombat) return "idle";
  if (unit.recentDamageDealt > unit.recentDamageTaken + 0.5) return "winning";
  if (unit.recentDamageTaken > unit.recentDamageDealt + 0.5) return "pressed";
  return "engaged";
}

export function getUnitMoraleStatus(unit: Unit): string {
  return unit.state === "broken"
    ? "BROKEN"
    : unit.state === "routing"
    ? `ROUTING ${Math.max(
      0,
      Math.ceil(ROUTING_DECISION_SECONDS - unit.routingTimer),
    )}s`
    : unit.state === "shaken" ? "SHAKEN" : "STEADY";
}

export function getUnitActivityText(activity: UnitActivityStatus): string {
  if (activity === "idle") return "";
  if (activity === "flanked") return "FLANKED!";
  if (activity === "repathing") return "FALLING BACK";
  if (activity === "lowAmmo") return "LOW AMMO";
  if (activity === "outOfAmmo") return "OUT OF AMMO";
  return activity.toUpperCase();
}

export function getUnitStatusText(unit: Unit): string {
  const morale = getUnitMoraleStatus(unit);
  const activity = getUnitActivityStatus(unit);
  if (activity === "idle") return morale;
  return `${getUnitActivityText(activity)} · ${morale}`;
}
