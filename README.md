# The Last Eagle — Grid Formation Prototype

A playable turn-based formation-tactics prototype set inside the existing *Roman Withdrawal / The Last Eagle* campaign shell. Battles use PixiJS v8 and a strict 20×14 square grid presented through a fixed 2:1 isometric camera. The tactical object is a block occupying one model square; formations are connected groups of blocks rather than oversized single units.

The campaign selection, mission briefing, deployment, progress saving, debrief, and post-battle conversation remain in place. Entering a mission now launches the grid prototype instead of the former real-time isometric battle.

## Install and run

Requires a current Node.js release and npm.

```bash
npm install
npm run dev
```

Vite opens the local game page. Do not open `index.html` directly.

Checks:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

`npm run test` runs the complete Vitest suite, including deterministic grid-battle rule coverage.

## Roman campaign

**The Wall in Shadow** is a three-mission Roman campaign. Victories unlock the next mission and save progress locally; completed missions remain replayable from the mission list.

1. **Beyond Hadrian's Wall** — a fixed three-formation defence against the Pict assault.
2. **The Blackwater Ford** — choose three or four formations to break a Saxon river bridgehead.
3. **The Raven at Vindolanda** — choose five of the six Roman formations for the campaign finale.

Every mission uses the established briefing, tactical map, deployment, companion conversation, battle report, casualty-aware debrief, and post-battle cutscene flow. The six formation commanders use portrait artwork from `Art/Characters/Roman`; stable companion IDs let the same portraits follow them through every mission and saved campaign.

## Controls

| Input | Action |
| --- | --- |
| Click a block | Select its formation |
| Click a selected formation block again | Select that individual block |
| Click a highlighted square or enemy | Confirm the current action |
| Mouse wheel | Zoom toward the pointer (0.5×–1.75×) |
| Middle-mouse drag | Pan the battlefield |
| Hold `Space` and left-drag | Pan the battlefield |
| `F` | Frame the entire battlefield |
| `Home` | Restore the initial camera |
| Click the minimap | Re-centre the isometric camera |
| Right-click / Escape | Cancel the current action |
| `M` | Move, then choose a final facing |
| `A` | Attack with local pressure |
| `S` | Shoot one coordinated ranged volley |
| `C` | Charge with infantry or cavalry |
| `R` | Reform the selected block or transfer its character |
| `G` | Merge compatible connected formations |
| `X` | Brace close-order infantry for +1 armour until it moves |
| `H` | Hold and recover one morale |
| `V` | Fall back one square while engaged |
| `B` | Battle while engaged |
| `P` | Press with extra pressure and occupy vacated gaps |
| Tap `Space` | End the selected formation’s activation |
| `D` | Toggle block-level debug information and debug tools |
| `Backspace` | Recreate the initial scenario exactly |

The buttons remain available for mouse-only play. Hover a square to see its coordinate, terrain, and occupants.

## Isometric presentation

The rules still store integer `GridPosition` values and accept only north, east, south, and west. Rendering projects a grid coordinate with:

```text
screen x = (grid x - grid y) × 48
screen y = (grid x + grid y) × 24
```

Tiles are therefore 96×48 diamonds. North appears upper-right, east lower-right, south lower-left, and west upper-left. Pointer picking first converts the canvas pointer through the camera transform, applies the inverse projection, then tests nearby candidates against the diamond equation rather than rounding blindly.

The camera owns only world-container translation and uniform scale. Zoom is cursor-centred and clamped to 0.5×–1.75×; bounds always leave part of the map recoverable. The minimap remains top-down and uses model grid coordinates directly.

Terrain is built once as static diamond graphics. Blocks, shadows, exposed formation edges, soldiers, characters, and effects are projected independently so figures remain upright. Moving blocks interpolate fractional grid coordinates and project each animation frame. Rear-to-front order uses `(gridX + gridY) × 10,000`, followed by stable grid and local-priority tie-breakers.

## Turn sequence

The player controls Rome and the computer controls the Saxons. Romans activate one formation, then the Saxon AI activates one formation, alternating until every eligible formation has activated. The game then resolves all contested-square melees and character duels, applies end-of-round morale pressure, resets movement and retreat flags, and starts the next round with Rome.

A formation normally performs one main action. Move is the exception: it may take repeated cardinal steps while movement remains, then chooses a final facing and ends its activation. Close-order infantry may instead Brace, ending its activation and gaining +1 armour until any of its blocks next moves.

The AI is deterministic and operates at formation level. It prioritises formations already in contact, chooses Battle or Press from the local pressure situation, takes legal charges and ranged volleys, and otherwise searches cardinal formation translations toward the nearest enemy. That search can spend a complete activation moving laterally around blocked ground and uses the same terrain, reordering, trigger, combat, and turn commands as the player. If no advance is legal, close-order infantry Brace and other formations Hold. It does not pathfind or make decisions for individual soldiers.

## Core rules

### Movement, facing, and support

Formations normally translate as rigid connected footprints. Every step is north, east, south, or west; there is no individual-soldier pathfinding. When terrain prevents the full footprint from translating but leaves a connected passage, a deterministic **reorder move** narrows the block footprint from the front and fills ranks behind it. Any Move or Fall back that changes the footprint or creates terrain overflow pauses for confirmation. Its destination shadows use `!` for certain block positions. At the end of Move, the player chooses any cardinal facing. The blocks pivot in place rather than wheeling, and all characters cross to the middle of the new front rank.

Front, side, and rear edges are derived from facing. A block receives up to two points of rear support from uncontested blocks of its formation directly behind it.

### Pressure

Every front block attacks the enemy block directly ahead; there is no formation-wide attack roll.

Each formation owns one unit profile: model count, model size, Attack, Armour, Defence, HP per model, unit type, Movement, and equipment. Blocks only track how those models are distributed, including any partial wounds. Pressure, Resistance, and block capacity are derived values rather than independent unit stats: unit type supplies the base, while open or closed formation supplies the formation modifier and available model space.

```text
attacking pressure =
  unit-type pressure
  + formation pressure
  + rear support
  + morale modifier
  + host-character bonus
  + charge attack bonus or cavalry momentum
  - disorder penalty

defending resistance =
  unit-type resistance
  + formation resistance
  + rear support
  + morale modifier
  + host-character bonus
  + terrain modifier
  + facing modifier
  + braced-spear bonus
  - disorder penalty
```

Every player order first passes through one non-mutating planner. Simple orders execute immediately, while Attack, Charge, Battle, Press, and formation-changing movement pause on the same board confirmation. The combat preview shows both totals, net pressure, expected damage or retreat quality, retreat destinations, possible cascade, compression risk, and local character modifiers. `!` marks fixed destinations and `?` marks positions that depend on combat resolution.

Every melee contact also resolves a small deterministic casualty check. Pressure decides whether the defender holds or retreats; damage decides how many soldiers die:

```text
raw damage = unit Attack + character + flank + terrain modifiers
Defence = deterministic percentage chance to evade all damage
Armour = flat damage reduction
front-face shield = +1 Armour
side or rear contact = +1 flanking damage and no shield block
braced close-order infantry = +1 Armour until it moves
maximum = 4 damage per attacking block
```

The Defence roll is derived deterministically from the round and the two block identities, so identical resets remain exactly reproducible. If the attack is not evaded, Armour, frontal shield Armour, and Brace Armour reduce its damage. Damage is then applied to HP; a model disappears only when its HP is exhausted, with partial wounds retained on the block.

One model is one visible person. Model size controls how much formation space it consumes, not its HP. Each lost model removes one soldier mark and contributes to morale shock, so losses make subsequent good-order and chaotic retreats progressively more likely. Casualty events show a red floating count and fallen-figure flash on the affected square.

### Ranged combat

Ranged formations spend one ammunition point for one coordinated unit volley; individual arrows and javelins are presentation only and never become simulation entities. Every surviving formation block that has the target inside its weapon range, 90-degree forward arc, and unobstructed line of sight contributes its models to the volley. Buildings, impassable terrain, and large trees can therefore screen some files while others continue firing. **Shoot** is unavailable while engaged and ends the formation's activation.

Volley damage is deterministic. Each participating firing block strikes a separate legal block in the chosen target formation, so a five-block firing line can spread its volley across five target blocks. Every impact shows a shielded-to-exposed damage range; frontal shields deterministically block a weapon-specific share of lanes, then armour, bracing, and Defence reduce the result. Weapon-specific shield and armour penetration preserve the distinctions established in Roman Campaign Two. When Shoot is chosen, every legal enemy block is highlighted: stronger highlights and more pips mean more formation blocks can fire at that target, while every block able to participate is highlighted. The confirmation overlay marks every impacted target block and shows its damage range, shield block chance, ammunition cost, target edge, and complete calculation before the volley resolves. The prototype Sagittarii begin with twelve composite-bow volleys; ammunition is conserved proportionally when a formation splits and recombined when compatible fragments merge.

Roman close-order century formations use nine blocks of nine occupants. *Legio I Augusta* therefore contains 80 ordinary soldiers and one centurion: the centurion replaces one regular mark rather than being drawn as a tenth person in his square. Saxon infantry formations use more blocks than Roman centuries; the prototype Great Warband has fifteen close-order blocks.

### Engagement orders

A formation is engaged whenever one of its blocks is orthogonally adjacent to an enemy or shares a contested square. Engaged blocks receive an orange outline and the ordinary movement/attack controls are replaced by three orders:

- **Fall back:** reverse the complete formation one square without changing facing.
- **Battle:** every block in contact fights one adjacent enemy. Pressure adds disorder but only forces a surviving enemy block back when its formation has lost morale during that Battle. A lagging file may dress up to the formation's existing foremost rank; if that movement creates a new contact, the arriving block immediately fights its own pressure exchange. Steady blocks directly behind follow to keep the file intact. A file already on the front rank does not pursue beyond it.
- **Press:** every contacting block receives +2 pressure for that activation and advances into any enemy square it forces open. When a front block advances, each steady block directly behind it follows forward one square, shifting the complete file. A block at disorder 2 or higher is wavering and stops the follow movement for itself and every block behind it.

Battle and Press preview every participating contact together before they resolve. The overlay includes both factions: possible holds, retreats, removals, formation refills, and Press file advances are marked with `?`.

When a formation chooses **Battle** or **Press**, every participating block adopts a local engagement facing toward its nearest enemy. This lets an enveloping formation turn its front edges inward around the target; local facing also governs rear support, frontal shield Armour, brace-against-charge equipment, and flank or rear damage. Moving, choosing a finish facing, reforming, retreating, merging, or charging clears those local facings and restores the formation's shared facing.

When an engaged formation is selected for a new activation, one deterministic unit-level pass lets its blocks move one square toward nearby enemies where that closes an open fighting-line gap without worsening formation connectivity. This is formation adjustment, not individual soldier pathfinding.

### Block retreat and cascades

A pressured block retreats directly away from the attacker, regardless of its own facing. Neighbouring blocks do not automatically retreat with it.

Formed troops under manageable pressure retreat in good order. If a friendly block occupies the retreat square, the rules trace away from the attacker until they find empty legal ground. The chain shifts from rear to front and every displaced block gains disorder.

Overwhelming pressure, low morale, an already-disordered formation, or heavy block disorder causes a chaotic retreat. The contacted block always withdraws orthogonally away from its attacker; following blocks may alternate between rear-left and rear-right escape lanes. They gain extra disorder and morale loss, and disconnected groups become fragments that must reform and merge. If the contacted block is driven into an enemy behind it, both occupy a contested square. If no legal retreat or escape lane exists because of terrain, contested squares, or the map edge, the original block is compressed: it takes additional damage and disorder, its formation loses morale, and the attackers may create a contested square.

This makes empty recovery space behind a line valuable and tightly packed reserves potentially dangerous.

### Formation splitting, reforming, and merging

Connectivity is orthogonal; diagonal contact does not count. It is recalculated after movement, retreat, cascades, destruction, contested-cell changes, reform, and merge. A formed unit with at least seven surviving blocks can absorb a temporary separation while its morale remains above 3. Detached blocks become wavering but stay under the parent formation's orders. Chaotic retreat bypasses this staying-power stage and can split the formation immediately.

When a formation breaks apart, the component containing its commander retains the original identity. Without a commander, the largest deterministic component remains the main body. Spatially close pockets are clustered so one original unit can produce no more than three command groups, even after later shocks. The breakup is provisional for its first shared activation rather than immediately creating several independent turns.

Selecting either provisional group spends one activation for the whole family. **Battle** and **Press** collect attacks from every sibling group that is currently engaged, so both halves fight during the same order. At activation end, touching siblings merge automatically and every separated fragment takes one free legal cardinal step toward the family. The main body holds position rather than chasing fragments. Contested blocks, occupied destinations, impassable terrain, and the map edge can prevent this regroup step.

If all groups reconnect during that attempt, the breakup is cancelled and the reunited unit remains activated. If they are still separated, the split is confirmed: every group is marked activated for the current round and becomes independently selectable from the next round onward.

Reform moves one selected uncontested block to an adjacent empty square that is not beside an enemy and reconnects to friendly blocks. Manual Merge still joins other compatible connected formations. For automatic original-unit reunion, the main-body identity is preferred; otherwise the commander-containing or larger group keeps its identity.

### Characters

Characters are attached visibly to one host block. Their main pressure, resistance, and melee modifiers apply locally to that block. Commanders also provide a smaller two-square command effect and determine identity retention after a split. A finish-facing pivot transfers and animates every attached character toward the middle of the new front rank.

Reform can transfer a character to an adjacent uncontested block in the same formation. When a host block is destroyed, the character attempts to escape to an adjacent friendly block and takes a wound; without one, the character is defeated.

### Charges

Formed, uncontested infantry may charge one or two squares straight forward into contact. Forest, rough ground, or shallow water reduces that maximum to one square. The clicked enemy establishes the legal approach lane and landing footprint, then every front-rank block that contacts an enemy resolves its own charge from left to right. Each infantry contact gains +2 pressure unless that specific defender presents a braced front. When a charging block advances into a gap, every block directly behind it shifts forward one square to keep the complete file together; cavalry breakthroughs use the same file-follow rule. Every charge pauses on a combined outcome preview: `!` marks fixed formation movement and `?` marks every contacting file, follow-up, or enemy position that depends on impact and retreat.

### Cavalry momentum

A charge must begin formed and uncontested, move straight forward through at least two clear squares, avoid rough ground, and end against an enemy. Momentum is capped at six:

```text
momentum = distance travelled + cavalry mass + character bonus
impact damage = max(1, floor(momentum / 3))
```

Impact damage resolves before ordinary pressure. Each contacting cavalry block carries momentum independently down its own lane. A defender that retreats or is destroyed lets that cavalry block advance, lose momentum, and potentially strike the next block; a defender that holds stops only that lane. Lanciarii have `brace_against_charge` equipment, but its Resistance and counter-damage apply only while the formation has used Brace and presents its front.

### Contested squares and duels

A square may contain one Roman and one Saxon block. It may never contain two blocks of the same faction or more than two blocks total. Contested blocks cannot move normally, provide support, or transmit formation connectivity.

At round end, both occupants calculate deterministic melee scores and take simultaneous damage. If one is destroyed, the survivor controls the square with lingering disorder. Characters sharing that square duel alongside the soldiers; wounds, defeat, formation morale shock, and a temporary victor bonus are all deterministic.

## Architecture

The campaign calls a stable `Game` adapter and receives its existing campaign battle report. The adapter owns `GridBattleController`; it does not construct the old real-time simulation.

New battle code lives under `src/gridBattle`:

- `ai`: deterministic formation activation planning and tactical target selection
- `model`: serialisable state, occupancy, and central balance constants
- `scenario`: deterministic prototype formations plus dedicated Hadrian's Wall, Blackwater Ford, and Vindolanda battlefield factories
- `rules`: movement, pressure, ranged combat, retreat, splitting, reform, merge, charge, melee, duels, and turns
- `commands`: typed commands, pure order planning on cloned state, confirmation policy, and the sole live-state mutation dispatcher
- `rendering`: PixiJS layers, fixed isometric projection/picking/depth/camera modules, and an event-consuming animation queue
- `app`: DOM panels, input routing, lifecycle, and campaign conclusion adapter

No file under `src/gridBattle/rules` imports PixiJS. Rendering never decides combat outcomes, and animations consume rule events rather than hiding rules inside callbacks. All balance values are in `src/gridBattle/model/config.ts`.

## Debug tools

Press `D` to display block IDs, grid/projected coordinates, depth keys, formation/component IDs, models, disorder, hovered picking candidates, camera position, and zoom. The debug panel can toggle projected cardinal axes, frame the board, damage or retreat the selected block, force a split, create a contested cell, resolve melees, and restore morale. Reset is deliberately deterministic.

## Known edge cases

- The TEST SCENARIO keeps the original demonstration map and its three Saxon formations, and deploys the Roman formations chosen for it. Its ballistarii fight as light infantry with their ranged weapon, because the grid battle has no separate artillery rules yet.
- Attack follow-up is automatic after an overwhelming retreat and is shown in the on-board `?` outcome preview before confirmation.
- Charge continuation models a straight breakthrough, but offers no optional mid-charge stop prompt yet.
- Reform moves one block one square; it does not preview a complete reconstructed formation shape.
- Split feedback uses a short text/edge flash rather than a persistent history view of the severed connection.
- Casualties remove soldier marks immediately and use a short fallen-figure flash; persistent corpse markers are intentionally deferred until combat pacing is proven.
- At minimum zoom, debug labels intentionally overlap; they are diagnostic and are not part of the normal battlefield presentation.
- At narrow desktop widths the side panels take priority over enlarging the board; a dedicated mobile layout is outside this mechanics prototype.
- The Saxon AI evaluates one formation activation at a time. Multi-formation plans, long-term objectives, difficulty levels, and player-selectable computer factions are deliberately omitted until the basic formation game is proven.

The next useful experiment is whether the unified preview makes multi-contact Battle and Press outcomes sufficiently legible without adding per-contact choices.
