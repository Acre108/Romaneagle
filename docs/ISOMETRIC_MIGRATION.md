# Isometric migration audit

## Coordinate ownership

- `Simulation`, `Battlefield`, `FormationOrderLayout`, formation slots, scenario positions, combat, morale, and AI use ordinary Cartesian world coordinates. They remain authoritative.
- `Camera` owns a logical world-space centre. It is the only bridge between viewport coordinates and the selected projection.
- Renderers consume world coordinates and project them for Canvas drawing.
- `Game` keeps pointer drags in screen space for selection, and converts ground interactions through `Camera.screenToWorld`.
- The DOM HUD remains entirely in viewport space.

## Coupling found before migration

- `Camera.worldToScreen` and `Camera.screenToWorld` previously embedded a top-down linear transform.
- `Renderer` installed a world-to-canvas transform and then drew terrain, units, effects, and previews as though Canvas coordinates were world coordinates.
- `Game` divided middle-drag pixels by zoom and passed the result directly into world-space camera movement.
- Point selection inverted the camera transform, while box selection projected unit anchors into the viewport.
- Formation-facing drags already stored world-space endpoints after pointer inversion.

## Migration boundary

The dedicated `IsometricProjection` module owns all dimetric projection and inverse-projection maths. The isometric renderer projects world anchors at draw time. Camera pan converts screen vectors back into world vectors. No gameplay system depends on projected coordinates.

During migration, `?renderer=topDown` retains the legacy presentation for regression comparison. Isometric mode is the default.
