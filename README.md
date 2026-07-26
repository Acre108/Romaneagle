# The Last Eagle — Isometric Prototype 0.2

A low-budget real-time formation tactics prototype set in Britain in 402 AD. It uses a charming Canvas 2D isometric presentation to test whether selecting and manoeuvring dense formations made from many tiny flat soldiers feels satisfying.

## Setup

Requires a current Node.js release and npm.

On Windows, double-click `PLAY_GAME.cmd`. It installs the development dependencies on the first launch, starts the local game server, and opens the correct browser address.

Do not open `index.html` directly: browsers cannot run the TypeScript source file without Vite.

Or launch it from a terminal:

```bash
npm install
npm run dev
```

Vite opens the game automatically. Keep the terminal window open while playing and press `Ctrl+C` to stop it.

## Checks

```bash
npm run typecheck
npm run test
npm run build
```

## Controls

| Input | Action |
| --- | --- |
| Left click | Select a Roman formation |
| Shift + left click | Add or remove a formation from the selection |
| Left drag | Box-select Roman formations |
| Right click ground | Move selected formations |
| Right click enemy | Follow and keep engaging that formation |
| Right drag | Draw the destination frontage; the arrow shows facing before release |
| Middle-mouse drag | Pan the camera |
| WASD / arrow keys | Pan the camera in screen-relative directions |
| Mouse wheel | Zoom |
| Space | Pause |
| 1 / 2 / 3 | Set game speed |
| L / C / B | Line / column / mob |
| G | Use each selected formation's unique ability, if it has one |
| F | About face in place after a two-second reorganisation |
| H | Hold |
| R | Rally a shaken or routing formation when safely away |
| Escape | Clear selection |
| F3 | Toggle the debug display |
| T | Toggle the gameplay-terrain overlay |

The buttons in the command and speed bars are clickable too.

## What is implemented

- A continuous, repeatable 2400×1600 world projected through a classic 2:1-style dimetric view.
- Isometric grass, dirt road, rough ground, deep and shallow stream reaches, bridge, flowers, rocks, and low-poly trees with no gameplay elevation.
- Four 80-man Roman infantry formations, one 50-man Roman cavalry formation, four 70-man Saxon infantry formations, one 60-man Saxon skirmisher formation, one 60-man archer formation per army, and one 16-man battle-standard unit per army: 862 visible standees at full strength.
- Unit-level simulation with lightweight soldier slots. Soldiers interpolate between slots when reforming but never pathfind or think independently.
- Globally depth-sorted upright standees, standards, trees, rocks, and combat effects, with eight quantised facing treatments.
- Projected ground footprints, inverse-projected mouse picking, screen-space box selection, and isometric formation-facing previews.
- Viewport culling and pooled render records, with live unit, body, equipment, escape-visual, terrain-object, culled-object, and render-timing counts in the F3 display.
- Line, column, shieldwall, tortoise, and mob layouts with movement and combat trade-offs. G is a unit-specific ability command: Roman infantry form a dense tortoise and Saxon infantry form a shieldwall, while formations without a configured ability leave the command unavailable. A tortoise's front rank keeps square shields forward while the following ranks raise a square-tiled roof of shields. Tortoises resist attacks from the front and sides, count as flanked only when struck from behind, and are extremely resistant to frontal arrows, but are slow to move. Mobs move directly without wheeling but are vulnerable and poor in combat.
- Changing formation halts the unit and locks its commands for five seconds while its soldiers reorganise.
- Accelerated movement, inside-flank formation wheeling, limited slow Roman friendly interpenetration, crowded-footprint separation, rough-ground and shallow-water penalties, impassable deep water, road-column bonus, stamina, and cohesion-driven visual disorder. Formed units use a deterministic five-point elastic frontage spine: terrain and enemy contact bend shared control points, while every soldier remains a subordinate row-and-file occupant offset from the interpolated curve. This keeps files connected around trees, rocks, riverbanks, map edges, and oblique contacts without soldier pathfinding. Non-combat Saxon formations can flow completely through one another, becoming vulnerable while their ranks intermingle; ordinary blocking returns at enemy contact. Saxon formations use wider, irregular loose ranks and a more responsive spine; their unique Shieldwall ability deliberately tightens those ranks. Mobs and routers retain loose per-slot deformation. Formed enemies are kept at frontage contact instead of continuing through one another.
- Selection, box selection, multi-unit spacing, move/facing orders, persistent enemy-target attack orders, camera controls, pause, and speed controls. Accepted attack targets briefly flash their footprint and information border red.
- About-face reverses a formation after a two-second command lock. Soldiers turn where they stand instead of wheeling or rotating bodily around the formation centre.
- Periodic abstract melee with occupied-footprint contact, formation blocking, and cohesive oblique frontage wrapping: unsupported files trail behind ordinary contacts instead of detaching. When a broad line meets a compact tortoise, whole outer files bend around its corners instead of stacking against one face, but the tortoise retains side protection until attackers reach its rear. Slower exchanges let weak attacks fail against prepared formations instead of guaranteeing a casualty every tick. Formations charge into nearby enemies and deal double damage for three seconds after impact; cavalry is strongest on flanks and unreliable against formed infantry frontally.
- Roman and Saxon archer formations carry twelve deterministic unit-level volleys and fire at a deliberate cadence while stationary, within range, and outside melee contact. Reload time cannot accumulate before a target enters range. The unit panel reports remaining volleys, while `LOW AMMO` and `OUT OF AMMO` appear beneath depleted formations. Front-facing infantry shields stop most arrows, shieldwalls stop more, and Roman tortoises provide the strongest frontal cover. Archers retain attack orders and close for weak melee when empty. Bows, flying arrow clusters, blocked-volley feedback, and heavier outlined damage numbers keep ranged exchanges legible without introducing individual projectile simulation.
- Morale, steady/shaken/routing/broken states, rallying, nearby rout pressure, and battlefield-edge escape. Formations rout at 35 morale, cancel conflicting formation actions, commit to one weighted flee direction, and show a ten-second routing countdown. At its end, a formation that has made meaningful progress away from the enemy is counted as routed; one that is caught or stalled breaks. Zero morale breaks immediately, with a prominent `BROKEN!` callout. Broken survivors discard their equipment, leave the simulation permanently, and continue off-map as unarmed escape visuals.
- Battle-standard units project a visible 230-unit aura. A friendly formation with at least 50% of its logical slots inside steadily recovers morale and shows `INSPIRED`. The Saxon standard follows behind the active Saxon army rather than waiting at its deployment point. Wiped-out standard units drop their standard; enemy infantry that reach it capture and carry the persistent trophy.
- Combat morale uses a short recent-performance memory: formations that are inflicting more casualties than they suffer lose morale more slowly, with prepared and standard states adding further resistance.
- Color-coded tactical readiness: vulnerable formations in rough ground, streams, friendly formations, mobs, or exposed flanks take extra damage; standard formations become prepared after five stationary seconds, while shieldwalls and tortoises are prepared immediately. A tortoise remains prepared while moving slowly through clear terrain, but difficult terrain or exposed rear contact downgrades it. Other prepared formations lose readiness when they move, and readiness cannot improve during combat.
- Compact status strips beneath unit labels show reorganisation, charging, flanking, combat momentum, and steady/shaken/routing morale at a glance.
- Unit information is drawn in a final screen-space overlay. Overlapping labels step sideways and retain a leader line to their formation.
- Visual formation ranks compress and curve around riverbanks, tree canopies, rocks, and battlefield edges while remaining subordinate to unit-level movement.
- A toggleable gameplay-terrain overlay shows the exact road, rough, woods, shallow-water, and deep-water regions used by the simulation. Terrain applies only when more than 20% of a formation’s logical slots are inside it. During a committed crossing, that coverage follows the spine-deformed slots so a line can compress around deep-water edges without pretending its old rectangle still occupies them. Saxon AI keeps its chosen formation through the approach, crossing, and far-bank clearance; it no longer automatically enters Mob or pauses to reorganise. Crossing commitments persist through the complete approach and exit.
- Saxon formations and multi-unit player attack orders reserve limited front, left-flank, right-flank, or rear engagement slots before closing. Broad faces can accept two narrow attackers, occupied faces force later units to seek another target or angle, and cavalry prefer flank or rear slots. A frontal attacker is never assigned a rear slot that would require it to pass through the target. Contacts that produce no damage for three seconds sidestep and request a new slot. Unit badges distinguish CLOSING from actual ENGAGED contact. Standards remain behind the fighting centroid and away from map edges.
- Enemy attack selection uses a generously padded formation footprint. Archers with attack orders stop at their preferred range instead of entering melee while ammunition remains. Tortoises retain Prepared protection while moving but cannot charge and deal reduced melee damage.
- Routed formations caught inside an enemy frontage take 50% more damage than a formed target, with cavalry still especially dangerous. Routers turn and flee directly instead of attempting a formed wheel. Near deep water, all subordinate slots stay committed to the formation centre's current bank instead of splitting or oscillating across the stream. Deep-water stalls accelerate the routing decision and erode morale rather than destroying a formation on a separate short timer.
- Battle victory ignores isolated standard units: when the last fighting formation on a side is gone, play pauses with a clear result and that side's surviving standard is left on the field as a dropped prize.
- Every casualty leaves a persistent faction-colored body and one discarded shield or weapon. Tortoise casualties are distributed beneath its occupied shield square, so a collapsing formation no longer leaves an artificial clean hole where it stood. Dense body concentrations slow movement, and friendly dead also reduce morale.
- Simple two-second Saxon targeting, flank opportunism, advance, hold, and rally logic.
- Static HTML/CSS interface and a toggleable live debug display.

## Projection and architecture

The prototype intentionally has only fourteen unit simulation entities. World positions, movement, formation slots, terrain sampling, collisions, combat, morale, and AI remain ordinary Cartesian `worldX`/`worldY` calculations.

`IsometricProjection` is the only owner of the dimetric projection:

```text
screenX = (worldX - worldY) × 0.5
screenY = (worldX + worldY) × 0.25 - visualElevation
```

Its exact inverse maps pointer positions back to the logical ground plane. `Camera` stores a world-space centre and translates screen-relative pan vectors through that inverse. The isometric renderer projects anchors only when drawing; fake tree and rock height never affects gameplay.

Each `Unit` owns formation state, five persistent frontage-spine points, and subordinate visual slot positions. The fixed-step `Simulation` remains responsible for movement, spine deformation, separation, combat, morale, and AI. The renderer draws terrain, projected footprints, depth-sorted standees/props/effects, and order previews on one Canvas 2D surface. `Game` owns the loop, camera, input, selection, and command dispatch. The DOM HUD remains unprojected and only updates existing elements.

Main modules:

- `src/core`: loop coordination, camera, and math utilities
- `src/world`: deterministic battlefield data and terrain sampling
- `src/units`: unit types and formation-slot generation
- `src/systems`: unit-level simulation, combat, morale, and AI
- `src/rendering`: Canvas battlefield, standee, effect, and order-preview rendering
- `src/scenario`: fixed prototype armies
- `src/ui`: existing-DOM HUD updates
- `src/tests`: deterministic formation, terrain, and combat checks

### Temporary renderer fallback

The previous top-down renderer remains available during migration verification:

```text
http://localhost:5173/?renderer=topDown
```

Isometric rendering is the default. The fallback will be removed only after longer playtesting confirms movement, selection, facing orders, combat, and performance.

## Known limitations

- Enemy formations route through the nearest viable bridge or shallow ford when deep water blocks a direct advance. A non-engaged enemy that makes no progress for three seconds visibly reorganises, falls back on a deterministic lateral offset, and requests a fresh route.
- River escape remnants are non-interactive visuals rather than soldier simulation entities. Their discarded equipment is decorative and does not create difficult terrain.
- General-purpose pathfinding remains deliberately out of scope: unit centres do not build navigation meshes or calculate full paths around one another, trees, rocks, or enemy formations.
- Ammunition cannot yet be replenished. Ranged combat does not model elevation, friendly fire, or line-of-sight obstruction by trees and formations.
- Attack orders target one specific formation. Attack-move, target priorities, queued orders, and automatic retargeting after that formation leaves play are not implemented.
- Contact uses oriented formation footprints around the soldier slots rather than individual soldier collision.
- Terrain is decorative and sampled from simple regions; it has no true elevation.
- Isometric scenery uses inexpensive upright procedural shapes rather than true 3D geometry or occlusion volumes.
- Soldier facing is quantised to eight procedural silhouettes; there is no animation or sprite pipeline.
- Very dense standee overlaps are ordered by each object’s ground anchor rather than a full occlusion system; unit information remains in the final overlay.
- Flank AI is opportunistic rather than strategic, and formations do not coordinate.
- Rallying is intentionally generous for prototype testing.
- Captured standards are trophies only: they do not project the original army’s aura, and standard recapture or victory scoring is not yet implemented.
- No audio, minimap, campaign layer, persistence, multiplayer, fog of war, or individual soldier AI.
