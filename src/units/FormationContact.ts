import type { Unit } from "./types";

export interface FormationContact {
  separation: number;
  normalX: number;
  normalY: number;
}

const SOLDIER_EDGE_INSET = 4;

export function formationHalfWidth(unit: Unit): number {
  return Math.max(5, unit.formationWidth * 0.5 - SOLDIER_EDGE_INSET);
}

export function formationHalfDepth(unit: Unit): number {
  return Math.max(5, unit.formationDepth * 0.5 - SOLDIER_EDGE_INSET);
}

function projectedRadius(
  halfWidth: number,
  halfDepth: number,
  sideX: number,
  sideY: number,
  depthX: number,
  depthY: number,
  axisX: number,
  axisY: number,
): number {
  return halfWidth * Math.abs(sideX * axisX + sideY * axisY)
    + halfDepth * Math.abs(depthX * axisX + depthY * axisY);
}

function separationOnAxis(
  centreX: number,
  centreY: number,
  axisX: number,
  axisY: number,
  aHalfWidth: number,
  aHalfDepth: number,
  aSideX: number,
  aSideY: number,
  aDepthX: number,
  aDepthY: number,
  bHalfWidth: number,
  bHalfDepth: number,
  bSideX: number,
  bSideY: number,
  bDepthX: number,
  bDepthY: number,
): number {
  const centreProjection = Math.abs(centreX * axisX + centreY * axisY);
  const radiusA = projectedRadius(
    aHalfWidth, aHalfDepth, aSideX, aSideY, aDepthX, aDepthY, axisX, axisY,
  );
  const radiusB = projectedRadius(
    bHalfWidth, bHalfDepth, bSideX, bSideY, bDepthX, bDepthY, axisX, axisY,
  );
  return centreProjection - radiusA - radiusB;
}

/**
 * Returns the signed gap between two occupied formation rectangles.
 * Positive values are separated; negative values overlap.
 */
export function calculateFormationContact(
  a: Unit,
  b: Unit,
  result: FormationContact = { separation: 0, normalX: 0, normalY: 0 },
): FormationContact {
  const aSideX = Math.cos(a.facing);
  const aSideY = Math.sin(a.facing);
  const aDepthX = -aSideY;
  const aDepthY = aSideX;
  const bSideX = Math.cos(b.facing);
  const bSideY = Math.sin(b.facing);
  const bDepthX = -bSideY;
  const bDepthY = bSideX;
  const aHalfWidth = formationHalfWidth(a);
  const aHalfDepth = formationHalfDepth(a);
  const bHalfWidth = formationHalfWidth(b);
  const bHalfDepth = formationHalfDepth(b);
  const centreX = b.position.x - a.position.x;
  const centreY = b.position.y - a.position.y;

  let separation = -Infinity;
  let normalX = 1;
  let normalY = 0;

  const testA = separationOnAxis(
    centreX, centreY, aSideX, aSideY,
    aHalfWidth, aHalfDepth, aSideX, aSideY, aDepthX, aDepthY,
    bHalfWidth, bHalfDepth, bSideX, bSideY, bDepthX, bDepthY,
  );
  if (testA > separation) {
    separation = testA;
    normalX = aSideX;
    normalY = aSideY;
  }
  const testB = separationOnAxis(
    centreX, centreY, aDepthX, aDepthY,
    aHalfWidth, aHalfDepth, aSideX, aSideY, aDepthX, aDepthY,
    bHalfWidth, bHalfDepth, bSideX, bSideY, bDepthX, bDepthY,
  );
  if (testB > separation) {
    separation = testB;
    normalX = aDepthX;
    normalY = aDepthY;
  }
  const testC = separationOnAxis(
    centreX, centreY, bSideX, bSideY,
    aHalfWidth, aHalfDepth, aSideX, aSideY, aDepthX, aDepthY,
    bHalfWidth, bHalfDepth, bSideX, bSideY, bDepthX, bDepthY,
  );
  if (testC > separation) {
    separation = testC;
    normalX = bSideX;
    normalY = bSideY;
  }
  const testD = separationOnAxis(
    centreX, centreY, bDepthX, bDepthY,
    aHalfWidth, aHalfDepth, aSideX, aSideY, aDepthX, aDepthY,
    bHalfWidth, bHalfDepth, bSideX, bSideY, bDepthX, bDepthY,
  );
  if (testD > separation) {
    separation = testD;
    normalX = bDepthX;
    normalY = bDepthY;
  }
  if (centreX * normalX + centreY * normalY < 0) {
    normalX = -normalX;
    normalY = -normalY;
  }

  result.separation = separation;
  result.normalX = normalX;
  result.normalY = normalY;
  return result;
}
