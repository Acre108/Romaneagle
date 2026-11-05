# Map triggers

Map triggers provide a small deterministic scenario layer without adding soldier-level AI or coupling map logic to rendering.
Definitions are authored on `BattlefieldMapDocument.triggers`; mutable progress lives in `GameState.triggerState`.

## Supported conditions

- `formation_enters`: fires after a relocated formation occupies any authored square. An optional `factionId` filters entrants.
- `round_starts`: fires when the authored round begins.
- `formation_destroyed`: fires when the named formation loses its final block.

Every trigger has an ID, editor label, `once` flag, one condition, and one or more ordered effects. A one-shot trigger is
consumed when it begins executing. A repeatable trigger may fire again after a later accepted command, but never more than
once during the same evaluation. Definitions execute in map order.

## Supported effects

- `character_interaction`: records speaker, text, optional character ID, and writes the exchange to the battle event log.
- `spawn_formation`: creates a complete unit-level formation from an authored unit profile and block footprint. A unit
  with `rangedWeaponId` arrives with that weapon's full ammunition; an unknown weapon is refused when the map loads.
- `activate_to_attack`: gives a named formation one immediate deterministic activation against the nearest block of the
  target faction. It advances by legal formation moves, faces a legal adjacent target, and resolves one pressure attack.

An effect can emit events that satisfy a later trigger in the same evaluation. Each trigger can still fire only once in that
chain, preventing recursive loops.

## Authoring and runtime safety

Use `addMapTrigger` and `removeMapTrigger`; map loading validates unique IDs, bounds, condition data, effect data, spawn
footprints, and unit profiles. Runtime spawning also checks live formation/block IDs, current occupancy, terrain capacity,
and battlefield bounds before changing state. A blocked or stale effect emits `trigger_failed` and does not overwrite units.
Effects run in their authored order, so place `spawn_formation` before `activate_to_attack` when activating a new arrival.

Trigger evaluation happens once after every accepted command and considers only events emitted by that command. It is
separate from rendering, uses formation/block state only, and does not dispatch nested player commands or advance the turn.

The prototype scenario includes `eastern-road-ambush`: move Legio I Augusta one square east so it occupies `(5,9)` to
exercise an interaction, spawn, and immediate hostile activation.

## Deliberately omitted

The prototype does not yet include branching dialogue choices, delays/timers, arbitrary scripts, objective state, trigger
visualisation in an editor, authored routes, or a general tactical AI planner. Add new condition/effect variants as typed,
validated data rather than callbacks embedded in map files.
